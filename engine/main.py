# pylint: disable=missing-module-docstring, missing-class-docstring, logging-fstring-interpolation, broad-exception-caught, line-too-long, too-many-locals, too-many-statements, wrong-import-position, unused-variable, missing-timeout, unused-import
import os
import shutil
import tempfile
import json
import logging
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI

# Load dotenv from workspace root (one level up)
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

# Set up logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("RepoReader.Engine")

from downloader import parse_github_url, download_github_zip, extract_zip
from chunker import is_valid_file, chunk_file
from embedder import HFEmbedder
from vector_db import QdrantManager

app = FastAPI(title="RepoReader AI Engine")

# CORS middleware config
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Qdrant Manager (Runs immediately when server starts.)
qdrant_manager = QdrantManager() #this calls __init__()inside your QdrantManager.Connection established once.

# Input Validation Models
class IndexRequest(BaseModel):
    repo_url: str
    repo_id: str
    github_token: Optional[str] = None

class ChatMessage(BaseModel):
    role: str #user
    content: str #hello

class ChatRequest(BaseModel): 
    repo_id: str
    question: str
    chat_history: List[ChatMessage] = []


def run_indexing_pipeline(repo_url: str, repo_id: str, github_token: Optional[str] = None):
    """
    Background worker that fetches, chunks, embeds and indexes a repo in Qdrant.
    Sends status callback requests to the Express backend.
    """
    import requests
    temp_dir = tempfile.mkdtemp(prefix="repo_reader_")
    zip_path = os.path.join(temp_dir, "archive.zip")
    extract_path = os.path.join(temp_dir, "extracted")

    collection_name = f"repo_{repo_id}"
    express_port = os.getenv("PORT", "5000")
    backend_url = os.getenv("BACKEND_URL", f"http://localhost:{express_port}")
    callback_url = f"{backend_url}/api/repos/{repo_id}/callback"

    try:
        # Step 1: Parse and download
        owner, repo_name = parse_github_url(repo_url)
        logger.info(f"Starting pipeline for {owner}/{repo_name} (ID: {repo_id})")

        # Override token from request if provided, else use environment
        token = github_token or os.getenv("GITHUB_TOKEN")
        download_github_zip(owner, repo_name, zip_path, token)

        # Step 2: Extract
        extracted_root = extract_zip(zip_path, extract_path)

        # Step 3: Initialize vector collection
        qdrant_manager.init_collection(collection_name)

        # Step 4: Recursive traversal & batch processing
        chunk_buffer = []
        total_chunks_indexed = 0
        batch_size = 100

        for root, dirs, files in os.walk(extracted_root):
            for file in files:
                file_path = os.path.join(root, file)
                if not is_valid_file(file_path):
                    continue

                # Split file into overlapping chunks
                file_chunks = chunk_file(file_path, extracted_root)
                if not file_chunks:
                    continue

                chunk_buffer.extend(file_chunks)

                # Index in batches of 100
                while len(chunk_buffer) >= batch_size:
                    batch = chunk_buffer[:batch_size]
                    chunk_buffer = chunk_buffer[batch_size:]

                    # Embed & upload
                    texts = [c["raw_code_content"] for c in batch]
                    embeddings = HFEmbedder.embed_batch(texts)
                    qdrant_manager.upsert_chunks(collection_name, batch, embeddings)
                    total_chunks_indexed += len(batch)

        # Ingest any remaining chunks in buffer
        if chunk_buffer:
            texts = [c["raw_code_content"] for c in chunk_buffer]
            embeddings = HFEmbedder.embed_batch(texts)
            qdrant_manager.upsert_chunks(collection_name, chunk_buffer, embeddings)
            total_chunks_indexed += len(chunk_buffer)

        logger.info(f"Ingestion completed. Indexed {total_chunks_indexed} total chunks into Qdrant collection '{collection_name}'")

        # Send READY callback to Node.js backend
        try:
            logger.info(f"Sending success callback to Express: {callback_url}")
            requests.post(callback_url, json={"status": "READY"})
        except Exception as cb_err:
            logger.error(f"Failed to send success callback to Express: {cb_err}")

    except Exception as e:
        logger.error(f"Error executing indexing pipeline: {e}", exc_info=True)
        # Send FAILED callback to Node.js backend
        try:
            logger.info(f"Sending failure callback to Express: {callback_url}")
            requests.post(callback_url, json={"status": "FAILED"})
        except Exception as cb_err:
            logger.error(f"Failed to send failure callback to Express: {cb_err}")
    finally:
        # Step 5: Clean up temp directory
        try:
            shutil.rmtree(temp_dir)
            logger.info(f"Cleaned up temp directory: {temp_dir}")
        except Exception as e:
            logger.warning(f"Failed to clean up temp directory {temp_dir}: {e}")


@app.post("/index-repo")
async def index_repo(payload: IndexRequest, background_tasks: BackgroundTasks):
    """
    Triggers repository indexing asynchronously.
    """
    try:
        # Validate URL before running background task
        parse_github_url(payload.repo_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Queue the indexing task
    background_tasks.add_task(
        run_indexing_pipeline,
        payload.repo_url,
        payload.repo_id,
        payload.github_token
    )

    return {"status": "accepted", "message": "Indexing has started in the background."}


@app.post("/chat/query")
async def chat_query(payload: ChatRequest):
    """
    Handles RAG search and returns a Server-Sent Events stream with LLM completion.
    """
    logger.info(f"Received chat request. Question: '{payload.question}', History size: {len(payload.chat_history)}")
    for idx, msg in enumerate(payload.chat_history):
        logger.info(f"  History[{idx}]: role={msg.role}, content_len={len(msg.content)}")
    collection_name = f"repo_{payload.repo_id}"

    # 1. Embed user question
    try:
        query_vector = HFEmbedder.embed_text(payload.question)
    except Exception as e:
        logger.error(f"Failed to embed question: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate query embedding.")

    # 2. Perform search in Qdrant
    matches = qdrant_manager.search_similar_chunks(collection_name, query_vector, limit=4)
    if not matches:
        logger.info(f"No semantic matches found in Qdrant collection '{collection_name}'. Using empty context.")

    # 3. Format citations and context
    citations = []
    formatted_context = ""
    for i, match in enumerate(matches, 1):
        citations.append({
            "index": i,
            "file_path": match["file_path"],
            "file_name": match["file_name"],
            "start_line": match["start_line"],
            "end_line": match["end_line"],
            "raw_code_content": match["raw_code_content"]
        })
        formatted_context += f"--- CITATION {i} ---\n"
        formatted_context += f"File: {match['file_path']} (Lines {match['start_line']}-{match['end_line']})\n"
        formatted_context += f"Code:\n{match['raw_code_content']}\n\n"

    # 4. Construct System Prompt
    system_prompt = f"""You are a helpful, advanced technical onboarding assistant. Your goal is to explain concepts and code within the repository context as clearly and comprehensively as possible.

Guidelines:
1. If the user's question is related to the repository, explain everything very clearly, step-by-step, using the provided code context. Always cite the precise file name and line numbers when referencing code.
2. If the user's question is NOT related to the repository or the provided code context, you MUST still answer the query to the best of your ability using your general knowledge. However, you MUST begin your response with a message stating that the query is not related to the repository (for example: "⚠️ Note: This query is not related to the provided repository codebase.").But only write this message if the question is unrelated to the repo context.

[RETRIEVED CODE CONTEXT]
{formatted_context}
"""

    # 5. Connect to LLM Chat provider (OpenAI compatible)
    llm_api_key = os.getenv("LLM_API_KEY")
    llm_api_base = os.getenv("LLM_API_BASE_URL")
    llm_model = os.getenv("LLM_MODEL", "meta-llama/Llama-3.3-70B-Instruct")

    if not llm_api_key:
        logger.error("LLM_API_KEY is missing from environment variables.")
        raise HTTPException(status_code=500, detail="LLM configuration error: API Key is missing on backend server.")

    # SSE Stream generator
    async def sse_event_stream():
        # First send citation metadata to the client
        yield f"data: {json.dumps({'type': 'citations', 'citations': citations})}\n\n"

        try:
            client = OpenAI(api_key=llm_api_key, base_url=llm_api_base)

            # Format chat history for OpenAI SDK
            system_role_supported = os.getenv("LLM_SYSTEM_ROLE_SUPPORTED", "true").lower() == "true"

            if system_role_supported:
                messages = [{"role": "system", "content": system_prompt}]
                for msg in payload.chat_history:
                    messages.append({"role": msg.role, "content": msg.content})
                messages.append({"role": "user", "content": payload.question})
            else:
                messages = []
                for msg in payload.chat_history:
                    messages.append({"role": msg.role, "content": msg.content})
                query_with_system = f"{system_prompt}\n\n[USER QUESTION]\n{payload.question}"
                messages.append({"role": "user", "content": query_with_system})

            try:
                response = client.chat.completions.create(
                    model=llm_model,
                    messages=messages,
                    stream=True
                )
            except Exception as api_err:
                err_str = str(api_err)
                if system_role_supported and ("system role" in err_str.lower() or "500" in err_str or "system" in err_str.lower()):
                    logger.warning(f"System role error detected during LLM call ({err_str}). Retrying with system prompt inside user message...")
                    fallback_messages = []
                    for msg in payload.chat_history:
                        fallback_messages.append({"role": msg.role, "content": msg.content})
                    query_with_system = f"{system_prompt}\n\n[USER QUESTION]\n{payload.question}"
                    fallback_messages.append({"role": "user", "content": query_with_system})

                    response = client.chat.completions.create(
                        model=llm_model,
                        messages=fallback_messages,
                        stream=True
                    )
                else:
                    raise api_err

            for chunk in response:
                if chunk.choices and len(chunk.choices) > 0:
                    delta_content = chunk.choices[0].delta.content
                    if delta_content:
                        # Send text tokens
                        yield f"data: {json.dumps({'type': 'token', 'token': delta_content})}\n\n"

            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        except Exception as e:
            logger.error(f"Error calling LLM provider: {e}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(sse_event_stream(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PYTHON_PORT", "8000"))
    logger.info(f"Starting engine uvicorn server on port {port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
