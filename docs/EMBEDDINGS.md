# Cortex AI - Embeddings System Documentation

Documentation for the embeddings system and vector generation.

## Table of Contents

- [Overview](#overview)
- [Embedder Interface](#embedder-interface)
- [Ollama Integration](#ollama-integration)
- [Vector Normalization](#vector-normalization)
- [Models](#models)
- [Configuration](#configuration)
- [Performance](#performance)
- [Troubleshooting](#troubleshooting)

---

## Overview

The embeddings system converts text into vector representations (embeddings) that capture semantic meaning. These vectors enable semantic search—finding memories by meaning rather than keywords.

### How It Works

```
Text Input
  ↓
Title + Content + Tags combined
  ↓
Sent to Ollama
  ↓
Ollama runs embedding model
  ↓
Receives vector (e.g., 768 dimensions)
  ↓
Normalize to unit vector
  ↓
Store in memory and index
  ↓
Use for similarity search
```

### Key Properties

- **Deterministic:** Same text always produces same embedding
- **Semantic:** Similar meanings produce similar vectors
- **High-dimensional:** Captures nuanced relationships
- **Fast:** Ollama provides fast local inference

---

## Embedder Interface

All embedding providers implement the `Embedder` interface:

```go
type Embedder interface {
    // Embed a single text string
    Embed(ctx context.Context, text string) ([]float64, error)

    // Embed multiple texts efficiently
    EmbedBatch(ctx context.Context, texts []string) ([][]float64, error)

    // Get embedding dimension (e.g., 768 for nomic-embed-text)
    Dimension() int
}
```

### Methods

#### Embed

Generates a single embedding for text.

```go
embedding, err := embedder.Embed(ctx, "What is JWT?")
if err != nil {
    return err  // Handle network errors, model errors, etc
}

// embedding: []float64 with Dimension() elements
```

**Use cases:**
- Single memory creation
- Search query embedding
- On-demand embedding

#### EmbedBatch

Generates embeddings for multiple texts efficiently.

```go
texts := []string{
    "JWT authentication",
    "OAuth2 flow",
    "Session management",
}

embeddings, err := embedder.EmbedBatch(ctx, texts)
if err != nil {
    return err
}

// embeddings: [][]float64 with len(texts) elements
```

**Use cases:**
- Importing multiple memories
- Batch processing
- Bulk updates

**Advantage:** May be faster than calling Embed() N times (depending on model)

#### Dimension

Returns the embedding vector dimension.

```go
dim := embedder.Dimension()
// For nomic-embed-text: 768
```

---

## Ollama Integration

Cortex AI uses Ollama to provide local, privacy-preserving embeddings.

### What is Ollama?

Ollama is a lightweight framework for running large language models locally:

- **Local-first:** Models run on your machine
- **Privacy:** No data sent to external services
- **Fast:** Optimized inference
- **Offline:** Works without internet
- **Free:** No API costs

### Installation

1. **Download Ollama:**
   - Visit https://ollama.ai
   - Download for macOS, Linux, or Windows

2. **Run Ollama service:**
   ```bash
   ollama serve
   ```

3. **Pull embedding model:**
   ```bash
   ollama pull nomic-embed-text
   ```

### Connection

**Default configuration:**
```yaml
embeddings:
  provider: ollama
  endpoint: http://localhost:11434
  model: nomic-embed-text
  timeout: 30s
```

Cortex AI connects to Ollama via HTTP API:

```
POST http://localhost:11434/api/embeddings

{
    "model": "nomic-embed-text",
    "prompt": "Your text here"
}

← Response:
{
    "embedding": [0.123, -0.456, ...]
}
```

### Configuration Options

```bash
# Custom endpoint
CORTEX_EMBEDDINGS_ENDPOINT=http://localhost:8000

# Custom model
CORTEX_EMBEDDINGS_MODEL=all-minilm-l6-v2

# Custom timeout
CORTEX_EMBEDDINGS_TIMEOUT=60s
```

---

## Vector Normalization

All vectors are normalized to unit vectors (L2 norm = 1).

### Why Normalize?

**Before normalization:**
```
Vector: [3, 4]
Magnitude: sqrt(3² + 4²) = 5
Range: unbounded
```

**After normalization:**
```
Normalized: [3/5, 4/5] = [0.6, 0.8]
Magnitude: sqrt(0.36 + 0.64) = 1.0
Range: [0, 1] for cosine similarity
```

### Benefits

1. **Consistency:** All vectors have same magnitude
2. **Efficiency:** Cosine similarity = dot product
3. **Interpretability:** Similarity score in [0, 1]
4. **Stability:** Unaffected by text length

### Formula

```
normalized = vector / ||vector||

where ||vector|| = sqrt(sum(x_i²))
```

### Implementation

```go
func normalizeVector(v []float64) []float64 {
    magnitude := 0.0
    for _, x := range v {
        magnitude += x * x
    }
    magnitude = math.Sqrt(magnitude)

    normalized := make([]float64, len(v))
    for i, x := range v {
        normalized[i] = x / magnitude
    }
    return normalized
}
```

---

## Models

### Recommended: nomic-embed-text

**Official:** https://ollama.ai/library/nomic-embed-text

```bash
ollama pull nomic-embed-text
```

**Characteristics:**
- **Size:** 274 MB
- **Dimension:** 768
- **Context length:** 2048 tokens
- **Speed:** Fast inference (~100-500ms)
- **Quality:** Excellent semantic understanding
- **License:** Apache 2.0

**Suitable for:**
- Production use
- Most use cases
- Good balance of quality and speed

**Configuration:**
```yaml
embeddings:
  provider: ollama
  model: nomic-embed-text
```

### Alternative Models

#### all-minilm-l6-v2

```bash
ollama pull all-minilm-l6-v2
```

- **Size:** 31 MB (smaller)
- **Dimension:** 384
- **Speed:** Very fast
- **Quality:** Good but lower than nomic-embed-text
- **Use case:** Fast inference on resource-constrained systems

#### sentence-transformers/all-mpnet-base-v2

```bash
ollama pull sentence-transformers/all-mpnet-base-v2
```

- **Size:** 438 MB
- **Dimension:** 768
- **Speed:** Moderate
- **Quality:** Excellent semantic understanding
- **Use case:** Research, maximum quality

### Model Selection

| Use Case | Recommended Model | Reason |
|----------|-------------------|--------|
| General purpose | nomic-embed-text | Best balance |
| Low resource | all-minilm-l6-v2 | Very fast |
| Maximum quality | all-mpnet-base-v2 | Best quality |
| Specific domain | Fine-tuned model | Domain expertise |

---

## Configuration

### Environment Variables

```bash
# Endpoint
CORTEX_EMBEDDINGS_ENDPOINT=http://localhost:11434

# Model name
CORTEX_EMBEDDINGS_MODEL=nomic-embed-text

# Request timeout
CORTEX_EMBEDDINGS_TIMEOUT=30s

# Max retries
CORTEX_EMBEDDINGS_MAX_RETRIES=3
```

### Config File

```yaml
# ~/.config/cortex-ai/config.yaml
embeddings:
  provider: ollama
  endpoint: http://localhost:11434
  model: nomic-embed-text
  timeout: 30s
  max_retries: 3
```

### Verify Setup

```bash
# Check Ollama is running
curl http://localhost:11434/api/tags

# Check model is available
curl -X POST http://localhost:11434/api/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model": "nomic-embed-text", "prompt": "test"}'
```

---

## Performance

### Inference Speed

**Single embedding:**
```
nomic-embed-text: 100-500ms per request
all-minilm-l6-v2: 50-200ms per request
```

Varies by:
- Hardware (CPU/GPU)
- Text length
- Ollama load
- Network latency (if remote)

### Optimization

#### Batch Processing

Use `EmbedBatch()` for multiple texts:

```go
// Better than N individual calls
embeddings, _ := embedder.EmbedBatch(ctx, longList)
```

#### Text Preparation

The system automatically combines:
```
text = title + " " + content + " " + tags
```

Shorter text = faster embedding:
- More focused content = better results anyway
- Titles should be descriptive but concise
- Tags should be relevant and concise

#### Memory Optimization

Cache embeddings in memory:
- Ollama caches model in GPU/RAM
- No re-loading between requests
- Keep Ollama service running

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| RAM | 4 GB | 8 GB+ |
| Storage | 500 MB | 2 GB |
| CPU | 2-core | 4-core+ |
| GPU | Not required | Optional (faster) |

---

## Troubleshooting

### "Connection refused" Error

**Problem:** Cannot connect to Ollama.

**Solution:**
1. Check Ollama is running:
   ```bash
   ollama serve
   ```

2. Check endpoint is correct:
   ```bash
   curl http://localhost:11434/api/tags
   ```

3. Check firewall/network

### "Model not found" Error

**Problem:** Model not available in Ollama.

**Solution:**
```bash
# Pull the model
ollama pull nomic-embed-text

# Verify
ollama list
```

### Slow Embedding Speed

**Problem:** Embeddings are very slow.

**Solutions:**
1. Check system load:
   ```bash
   top  # macOS/Linux
   Task Manager  # Windows
   ```

2. Use faster model (all-minilm-l6-v2)

3. Enable GPU acceleration if available

4. Increase timeout:
   ```yaml
   embeddings:
     timeout: 60s  # Increase from 30s
   ```

### Timeout Errors

**Problem:** Embedding requests timeout.

**Solutions:**
1. Increase timeout:
   ```bash
   CORTEX_EMBEDDINGS_TIMEOUT=60s cortex search "query"
   ```

2. Check Ollama logs
3. Restart Ollama service
4. Use faster model

### Different Embeddings for Same Text

**Problem:** Same text produces different embeddings.

**Cause:** Model quantization or implementation differences.

**Note:** This is normal with quantized models. Cosine similarity comparisons still work correctly.

### Out of Memory

**Problem:** Ollama runs out of memory.

**Solutions:**
1. Reduce batch size (import in smaller batches)
2. Restart Ollama to clear cache
3. Use smaller model (all-minilm-l6-v2)
4. Increase system RAM

---

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Embeddings architecture
- [CONFIGURATION.md](./CONFIGURATION.md) - Configuration options
- [STORAGE.md](./STORAGE.md) - Vector storage and indexing
- [DEVELOPMENT.md](./DEVELOPMENT.md) - Development setup
