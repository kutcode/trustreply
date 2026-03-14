"""Tests for the embeddings utility module."""

import numpy as np
from app.utils.embeddings import (
    compute_embedding,
    compute_embeddings,
    cosine_similarity,
    embedding_to_bytes,
    bytes_to_embedding,
)


def test_compute_embedding_returns_normalized_vector():
    emb = compute_embedding("What is your company name?")
    assert emb.shape == (384,), f"Expected (384,), got {emb.shape}"
    norm = np.linalg.norm(emb)
    assert abs(norm - 1.0) < 1e-4, f"Expected normalized vector, norm={norm}"


def test_compute_embeddings_batch():
    texts = ["Hello world", "How are you?", "Machine learning is great"]
    embs = compute_embeddings(texts)
    assert embs.shape == (3, 384)
    # Each should be normalized
    for i in range(3):
        norm = np.linalg.norm(embs[i])
        assert abs(norm - 1.0) < 1e-4


def test_round_trip_serialization():
    emb = compute_embedding("test serialization")
    data = embedding_to_bytes(emb)
    assert isinstance(data, bytes)
    restored = bytes_to_embedding(data)
    assert np.allclose(emb, restored, atol=1e-6)


def test_cosine_similarity_identical():
    emb = compute_embedding("identical text")
    score = cosine_similarity(emb, emb)
    assert abs(score - 1.0) < 1e-4


def test_cosine_similarity_similar_texts():
    a = compute_embedding("What is your company name?")
    b = compute_embedding("Please provide the name of your organization")
    score = cosine_similarity(a, b)
    assert score > 0.5, f"Expected high similarity, got {score}"


def test_cosine_similarity_different_texts():
    a = compute_embedding("What is your company name?")
    b = compute_embedding("The weather is sunny today in Tokyo")
    score = cosine_similarity(a, b)
    assert score < 0.5, f"Expected low similarity, got {score}"
