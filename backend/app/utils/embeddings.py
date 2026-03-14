"""Embedding model loading and caching utilities."""

from __future__ import annotations
import numpy as np
from functools import lru_cache
from sentence_transformers import SentenceTransformer

from app.config import settings

_model: SentenceTransformer | None = None


def get_model() -> SentenceTransformer:
    """Lazily load and cache the sentence-transformer model."""
    global _model
    if _model is None:
        _model = SentenceTransformer(settings.embedding_model)
    return _model


def compute_embedding(text: str) -> np.ndarray:
    """Compute the embedding vector for a single text string."""
    model = get_model()
    return model.encode(text, normalize_embeddings=True)


def compute_embeddings(texts: list[str]) -> np.ndarray:
    """Compute embedding vectors for a batch of text strings."""
    model = get_model()
    return model.encode(texts, normalize_embeddings=True, batch_size=32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two normalized vectors."""
    return float(np.dot(a, b))


def embedding_to_bytes(embedding: np.ndarray) -> bytes:
    """Serialize a numpy array to bytes for DB storage."""
    return embedding.astype(np.float32).tobytes()


def bytes_to_embedding(data: bytes) -> np.ndarray:
    """Deserialize bytes from DB back to a numpy array."""
    return np.frombuffer(data, dtype=np.float32)
