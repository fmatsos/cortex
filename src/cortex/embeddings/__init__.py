"""Embeddings generation for semantic memory."""

from cortex.embeddings.base import Embedder
from cortex.embeddings.ollama import OllamaEmbedder

__all__ = ["Embedder", "OllamaEmbedder"]
