from typing import List, Dict, Any
from pinecone import Pinecone
import requests
import os


class RAGHandler:
    """
    Handles Retrieval-Augmented Generation using Pinecone vector database.

    Expects embeddings to already exist in the Pinecone index.
    Uses Ollama's nomic-embed-text model for query embedding (matching
    the model used to create the stored embeddings).
    """

    def __init__(self):
        """
        Initialize RAG handler with Pinecone vector store.

        Reads configuration from environment variables:
            PINECONE_API_KEY        – Pinecone API key
            PINECONE_INDEX_NAME     – Name of the Pinecone index
            PINECONE_NAMESPACE      – Optional namespace within the index
            PINECONE_EMBEDDING_MODEL – Ollama embedding model name
            PINECONE_TEXT_FIELD     – Metadata field containing chunk text
            OLLAMA_BASE_URL        – Ollama server URL (default: http://localhost:11434)
        """
        self.api_key = os.getenv("PINECONE_API_KEY", "")
        self.index_name = os.getenv("PINECONE_INDEX_NAME", "")
        self.namespace = os.getenv("PINECONE_NAMESPACE", "") or None
        self.text_field = os.getenv("PINECONE_TEXT_FIELD", "text")
        self.embedding_model = os.getenv("PINECONE_EMBEDDING_MODEL", "nomic-embed-text")
        self.ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

        # Placeholder detection
        _placeholders = {"", "your_pinecone_api_key_here", "your_index_name_here"}

        if self.api_key in _placeholders or self.index_name in _placeholders:
            print("⚠ Pinecone not configured – set PINECONE_API_KEY and PINECONE_INDEX_NAME in .env")
            self.index = None
            return

        # ── Initialize Pinecone client ────────────────────────────────
        try:
            self.pc = Pinecone(api_key=self.api_key)
            self.index = self.pc.Index(self.index_name)
            print(f"✓ Pinecone connected  – index: {self.index_name}")
        except Exception as e:
            print(f"⚠ Pinecone connection failed: {e}")
            self.index = None
            return

        # ── Verify Ollama is running ──────────────────────────────────
        try:
            r = requests.get(f"{self.ollama_url}/api/tags", timeout=5)
            models = [m["name"] for m in r.json().get("models", [])]
            if any(self.embedding_model in m for m in models):
                print(f"✓ Ollama connected – embedding model: {self.embedding_model}")
            else:
                print(f"⚠ Ollama running but '{self.embedding_model}' not found. Available: {models}")
                print(f"  Run: ollama pull {self.embedding_model}")
        except Exception as e:
            print(f"⚠ Ollama not reachable at {self.ollama_url}: {e}")
            print("  Make sure Ollama is running: ollama serve")

    def _get_embedding(self, text: str) -> List[float]:
        """
        Generate an embedding using Ollama's local API.

        Args:
            text: Text to embed

        Returns:
            Embedding vector as a list of floats
        """
        response = requests.post(
            f"{self.ollama_url}/api/embed",
            json={"model": self.embedding_model, "input": text},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        # Ollama returns {"embeddings": [[...]]} for /api/embed
        return data["embeddings"][0]

    def retrieve(self, query: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """
        Retrieve relevant document chunks from Pinecone for a query.

        Args:
            query: The query string
            top_k: Number of top chunks to retrieve

        Returns:
            List of relevant documents with content, source, and similarity
        """
        if not self.index:
            print("⚠ Pinecone not available – returning empty context")
            return []

        try:
            # Generate query embedding via Ollama
            query_embedding = self._get_embedding(query)

            # Query Pinecone
            results = self.index.query(
                vector=query_embedding,
                top_k=top_k,
                include_metadata=True,
                namespace=self.namespace,
            )

            # Format results
            documents = []
            for match in results.get("matches", []):
                metadata = match.get("metadata", {})
                content = metadata.get(self.text_field, "")
                source = metadata.get("table", metadata.get("source", metadata.get("filename", "Knowledge Base")))
                score = match.get("score", 0)

                if content:
                    documents.append({
                        "content": content,
                        "source": source,
                        "similarity": score,
                    })

            return documents

        except Exception as e:
            print(f"⚠ Pinecone query failed: {e}")
            return []

    def add_documents(self, documents: List[Dict[str, Any]]) -> int:
        """
        Add documents to the Pinecone index.

        Args:
            documents: List of document dictionaries with 'content' and 'source'

        Returns:
            Number of documents added
        """
        if not self.index:
            raise Exception("Pinecone is not configured. Set PINECONE_API_KEY and PINECONE_INDEX_NAME in .env")

        try:
            vectors = []
            for i, doc in enumerate(documents):
                content = doc.get("content", "")
                source = doc.get("source", "unknown")

                embedding = self._get_embedding(content)
                vec_id = f"upload_{hash(content) & 0xFFFFFFFF}_{i}"

                vectors.append({
                    "id": vec_id,
                    "values": embedding,
                    "metadata": {
                        self.text_field: content,
                        "source": source,
                    },
                })

            # Upsert in batches of 100
            batch_size = 100
            for i in range(0, len(vectors), batch_size):
                batch = vectors[i : i + batch_size]
                self.index.upsert(vectors=batch, namespace=self.namespace)

            return len(documents)

        except Exception as e:
            raise Exception(f"Error adding documents to Pinecone: {e}")

    def clear(self) -> None:
        """Clear all vectors from the index (or namespace)."""
        if not self.index:
            raise Exception("Pinecone is not configured.")
        try:
            self.index.delete(delete_all=True, namespace=self.namespace)
        except Exception as e:
            raise Exception(f"Error clearing Pinecone index: {e}")

    def get_status(self) -> Dict[str, Any]:
        """Get the status of the Pinecone index."""
        if not self.index:
            return {
                "status": "not_configured",
                "documents_count": 0,
                "index_name": self.index_name or "N/A",
                "embedding_model": "N/A",
            }
        try:
            stats = self.index.describe_index_stats()
            ns_stats = stats.get("namespaces", {})
            ns_key = self.namespace or ""
            vec_count = ns_stats.get(ns_key, {}).get("vector_count", stats.get("total_vector_count", 0))

            return {
                "status": "active",
                "documents_count": vec_count,
                "index_name": self.index_name,
                "namespace": self.namespace or "(default)",
                "embedding_model": self.embedding_model,
            }
        except Exception as e:
            return {
                "status": "error",
                "error": str(e),
                "documents_count": 0,
            }
