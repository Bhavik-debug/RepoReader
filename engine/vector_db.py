# pylint: disable=missing-module-docstring, missing-class-docstring, logging-fstring-interpolation, broad-exception-caught, line-too-long, too-many-locals, too-many-statements, wrong-import-position, unused-variable, missing-timeout, unused-import
import os
import uuid
import logging
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

logger = logging.getLogger(__name__)

class QdrantManager:
    """
    Manages connections and operations on Qdrant vector database.
    Supports local in-memory fallback if credentials are not specified.
    """
    def __init__(self, host: str = None, api_key: str = None):
        self.host = host or os.getenv("QDRANT_HOST")
        self.api_key = api_key or os.getenv("QDRANT_API_KEY")

        if not self.host or self.host == ":memory:":
            logger.info("Initializing Qdrant client in local IN-MEMORY mode.")
            self.client = QdrantClient(":memory:")
        else:
            logger.info(f"Connecting to Qdrant cluster at {self.host}")
            self.client = QdrantClient(
                url=self.host,
                api_key=self.api_key if self.api_key else None
            )

    def init_collection(self, collection_name: str, vector_size: int = 384):
        """
        Creates a collection if it does not exist.
        Default vector_size is 384 (all-MiniLM-L6-v2 output dimension).
        """
        # Clean collection name (Qdrant collection name cannot contain spaces or special chars)
        collection_name = self.clean_collection_name(collection_name) #Makes collection name valid.

        try:
            exists = self.client.collection_exists(collection_name)
            if not exists:
                logger.info(f"Creating Qdrant collection: '{collection_name}'")
                self.client.create_collection(
                    collection_name=collection_name,
                    vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE)
                )
            else:
                logger.info(f"Qdrant collection '{collection_name}' already exists.")
        except Exception as e:
            # If old Qdrant version doesn't support, then they try this method
            try:
                self.client.get_collection(collection_name)
                logger.info(f"Qdrant collection '{collection_name}' exists.")
            except Exception:
                logger.info(f"Creating Qdrant collection: '{collection_name}'")
                self.client.create_collection(
                    collection_name=collection_name,
                    vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE)
                )

    def clean_collection_name(self, name: str) -> str:
        """
        Formats collection names to comply with Qdrant rules (alphanumeric, underscores, hyphens).
        """
        # Keep alphanumeric, underscores, hyphens
        cleaned = "".join([c if c.isalnum() or c in ('_', '-') else '_' for c in name])
        return cleaned.strip('_')

    def upsert_chunks(self, collection_name: str, chunks: list, embeddings: list):
        """
        Upserts a batch of chunks and embeddings into Qdrant (Stores vectors in Qdrant.).
        """
        if not chunks or not embeddings:
            return

        collection_name = self.clean_collection_name(collection_name)
        points = []

        for chunk, embedding in zip(chunks, embeddings):
            # Unique ID based on UUID
            point_id = str(uuid.uuid4())

            payload = {
                "file_path": chunk["file_path"],
                "file_name": chunk["file_name"],
                "raw_code_content": chunk["raw_code_content"],
                "start_line": chunk["start_line"],
                "end_line": chunk["end_line"]
            }

            points.append(
                PointStruct(
                    id=point_id,
                    vector=embedding,
                    payload=payload
                )
            )

        logger.info(f"Upserting {len(points)} points into collection '{collection_name}'...")
        self.client.upsert(
            collection_name=collection_name,
            points=points
        )#stores all vectors
        logger.info(f"Successfully upserted {len(points)} points.")

    def search_similar_chunks(self, collection_name: str, query_vector: list, limit: int = 4) -> list:
        """
        Searches for nearest neighbor chunks in Qdrant for a given query vector.(Used during RAG retrieval.)
        """
        collection_name = self.clean_collection_name(collection_name)
        try:
            results = self.client.search(
                collection_name=collection_name,
                query_vector=query_vector,
                limit=limit
            )

            # Format results into readable payloads
            matches = []
            for res in results:
                matches.append({
                    "score": res.score,
                    "file_path": res.payload.get("file_path"),
                    "file_name": res.payload.get("file_name"),
                    "raw_code_content": res.payload.get("raw_code_content"),
                    "start_line": res.payload.get("start_line"),
                    "end_line": res.payload.get("end_line")
                })
            return matches
        except Exception as e:
            logger.error(f"Error searching collection '{collection_name}': {e}")
            return []
