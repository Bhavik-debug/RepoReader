# RepoReader

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](#)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#)
[![Stars](https://img.shields.io/badge/stars-%E2%98%85%E2%98%85%E2%98%85%E2%98%85%E2%98%85-yellow.svg)](#)

> **A local-first, zero-overhead Codebase RAG DevTool.** Index repositories locally, calculate high-performance embeddings on your machine, and chat with your codebase using state-of-the-art LLM reasoning with exact file citations.

---

## 📖 Project Overview & The "Why"

Onboarding to a large, unfamiliar codebase is one of the most time-consuming bottlenecks in modern software engineering. Traditional approaches involve hours of manual code tracing, parsing complex dependency graphs, and reading outdated documentation.

**RepoReader** solves this by providing a local-first, zero-cost RAG (Retrieval-Augmented Generation) DevTool. Developers paste any public or private GitHub repository URL, and the system instantly clones the codebase, filters out non-code noise, partitions code files into semantic chunks, and vectorizes them locally. The user is then provided with a premium chat interface to interact with the codebase, query architectural decisions, trace function executions, and generate new, context-aware features with precise source file citations.

---

## 🏗️ System Architecture

Below is the execution flow and component interaction topology of RepoReader:

```
             ┌────────────────────────────────────────────────────────┐
             │                   React.js Frontend                    │
             └──────────────────────────┬─────────────────────────────┘
                                        │
                         HTTP Requests  │  SSE (Server-Sent Events)
                         & user context │  Dialogue / Citations
                                        ▼
             ┌────────────────────────────────────────────────────────┐
             │                Node.js Express Gateway                 │
             └──────────────────────────┬─────────────────────────────┘
                                        │
                       Database Queries │  FastAPI Proxy Requests
                       (Auth & Sessions)│  & RAG Pipeline Trigger
                                        ▼
                 ┌──────────────────────────────────────────────┐
                 │                   MongoDB                    │
                 │        (User, Session & Chat History)        │
                 └──────────────────────────────────────────────┘
                                        │
                                        │ Forwarding Requests
                                        ▼
             ┌────────────────────────────────────────────────────────┐
             │               Python FastAPI AI Engine                 │
             └──────┬───────────────────┬──────────────────────┬──────┘
                    │                   │                      │
       Download ZIP │                   │ HF Embedder          │ Semantic
       from GitHub  │                   │ (all-MiniLM-L6-v2)   │ Search
                    ▼                   ▼                      ▼
             ┌──────────────┐    ┌──────────────┐      ┌──────────────┐
             │  GitHub API  │    │ 384-d Vector │      │ Local Qdrant │
             │  (Downloader)│    │ Calculation  │      │ Vector DB    │
             └──────────────┘    └──────────────┘      └──────┬───────┘
                                                              │
                                            Context Retrieval │
                                            & Prompt Assembly │
                                                              ▼
             ┌────────────────────────────────────────────────────────┐
             │                     Hyperbolic API                     │
             │           (meta-llama/Llama-3.3-70B-Instruct)          │
             └────────────────────────────────────────────────────────┘
```

---

## ⚡ Core Features

- 🔒 **Multi-Tenant User Isolation**: Strict security partitioning. Codebases, Qdrant vectors, and chat history are scoped dynamically to the authenticated user's ID.
- 🚀 **Local Embedding Generation**: Utilizes Hugging Face's `all-MiniLM-L6-v2` locally to construct 384-dimensional vector representations without sending code to third-party embedding APIs.
- ⚡ **Asynchronous Ingestion Pipeline**: Code bases are downloaded and vectorized in the background, utilizing Python background workers to ensure the application remains highly responsive.
- 📂 **Exact File Citations**: Answers returned by the assistant reference the precise files, start/end lines, and matching code context, which can be viewed directly in the application's side drawer.
- 🤖 **Deep Code Synthesis**: Powered by `google/gemma-2-2b-it` via Hyperbolic inference API for high-quality, architecturally-sound code generation.

---

## 🛠️ Tech Stack

- **Frontend**: React.js, Lucide Icons, Custom Premium Glassmorphic CSS Styling.
- **Backend Gateway**: Node.js, Express.js, Mongoose.
- **AI Microservice**: Python 3.12, FastAPI, Uvicorn, Pydantic, HTTPX.
- **Databases**: MongoDB (document store), Qdrant (vector search engine).
- **Machine Learning**: Hugging Face Transformers, PyTorch, Tokenizers.
- **Infrastructure**: Docker & Docker Compose (Containerized MongoDB & Qdrant).

---

## 🚀 Local Setup & Installation

Follow these steps to run the complete RepoReader stack locally:

### 1. Clone the Repository
```bash
git clone https://github.com/Bhavik-debug/RepoReader.git
cd RepoReader
```

### 2. Run Database Infrastructure (Docker)
Start the pre-configured containerized instances of MongoDB and Qdrant:
```bash
docker-compose up -d
```
*Verify Qdrant is running on `http://localhost:6333` and MongoDB on `localhost:27017`.*

### 3. Set Up the Python AI Microservice
Set up a Python virtual environment and install the required dependencies:
```bash
cd engine
python -m venv venv

# Windows
.\venv\Scripts\activate
# Linux / macOS
source venv/bin/activate

pip install -r requirements.txt
python main.py
```
*The Python service starts on `http://localhost:8000`.*

### 4. Set Up the Node.js Express Gateway
Install server dependencies and launch the backend gateway:
```bash
cd ../backend
npm install
npm run dev
```
*The Node.js gateway starts on `http://localhost:5000`.*

### 5. Set Up the React Frontend
Install client dependencies and launch the development server:
```bash
cd ../frontend
npm install
npm run dev
```
*Open `http://localhost:3000` to interact with the application.*

---

## ⚙️ Environment Variables

Create a `.env` file in the **root directory** of the project and populate it with your credentials:

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/reporeader
PYTHON_PORT=8000

# Qdrant Config
QDRANT_HOST=http://localhost:6333
QDRANT_API_KEY=

# LLM Inference Config (Hyperbolic)
LLM_API_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_API_KEY=your_hyperbolic_or_nvidia_api_key
LLM_MODEL=google/gemma-2-2b-it # or meta-llama/Llama-3.3-70B-Instruct
LLM_SYSTEM_ROLE_SUPPORTED=false

# Optional GitHub Token (to index private repositories and increase rate limits)
GITHUB_TOKEN=your_github_personal_access_token
```

---

## 🔄 API Flow

### 📥 Ingestion Flow (`/api/repos/index`)
1. React Frontend sends a POST request with the repository URL to Express Backend.
2. Backend validates the URL, creates a user-scoped `repoId` (`{userId}_{owner}_{repo}`), saves a `Repository` record with status `INDEXING`, and triggers the Python AI engine's `/index-repo` endpoint.
3. Python service immediately returns a `200 Accepted` status and kicks off the indexing pipeline as an asynchronous background task.
4. Python downloader fetches the zipball from GitHub API, extracts it to a temporary directory, semantically chunks the files, constructs embeddings, and upserts them to the user-scoped Qdrant collection (`repo_{repoId}`).
5. Upon completion, Python service sends a status update callback POST to the Express Backend (`/api/repos/:repoId/callback`) which updates the MongoDB status to `READY`.

### 💬 RAG Query Flow (`/api/chats/:sessionId/query`)
1. User submits a technical query from the chat input.
2. Express Backend verifies session ownership and proxies the request to the Python service's `/chat/query` endpoint.
3. Python service embeds the query, searches the user-scoped Qdrant collection for similar code snippets, constructs the context-augmented prompt, and establishes a stream back to Node.js.
4. Express Backend pipes the SSE stream back to the React client, displaying real-time text completions and references.
