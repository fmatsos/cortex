# Cortex - Embeddings System Documentation

Documentation for the embeddings system and vector generation.

## Table of Contents

- [Overview](#overview)
- [Embedder Interface](#embedder-interface)
- [Ollama Integration](#ollama-integration)
- [Text Chunking](#text-chunking)
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

Cortex uses Ollama to provide local, privacy-preserving embeddings.

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

Cortex connects to Ollama via HTTP API:

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

# Chunking configuration
CORTEX_EMBEDDINGS_CHUNK_SIZE=8000
CORTEX_EMBEDDINGS_CHUNK_OVERLAP=200
CORTEX_EMBEDDINGS_CHUNK_STRATEGY=average
```

---

## Text Chunking

Cortex automatically handles long text content by chunking it into smaller pieces that fit within embedding model context limits.

### Why Chunking?

Embedding models have context size limits:
- **nomic-embed-text**: ~8192 tokens (~2048 tokens context)
- **all-minilm-l6-v2**: ~512 tokens
- **all-mpnet-base-v2**: ~512 tokens

When content exceeds these limits, Cortex automatically:
1. Splits text into overlapping chunks
2. Embeds each chunk separately
3. Combines embeddings using a configurable strategy

### How It Works

```
Long Text Input (15,000 chars)
  ↓
Check if > chunk_size (8000 chars)
  ↓ YES
Split into chunks with overlap
  ↓
Chunk 1: chars 0-8000
Chunk 2: chars 7800-15800 (200 char overlap)
  ↓
Embed each chunk separately
  ↓
Chunk 1 → [0.1, 0.2, ..., 0.9]
Chunk 2 → [0.3, 0.1, ..., 0.8]
  ↓
Combine using strategy (average/first/max_pool)
  ↓
Final embedding → [0.2, 0.15, ..., 0.85]
  ↓
Normalize to unit vector
  ↓
Store and index
```

### Configuration

```yaml
embeddings:
  chunk_size: 8000          # Max chars per chunk (0 = no chunking)
  chunk_overlap: 200        # Overlap between chunks for context
  chunk_strategy: average   # How to combine: average, first, max_pool
```

**Environment variables:**
```bash
CORTEX_EMBEDDINGS_CHUNK_SIZE=8000
CORTEX_EMBEDDINGS_CHUNK_OVERLAP=200
CORTEX_EMBEDDINGS_CHUNK_STRATEGY=average
```

### Chunk Strategies

#### Average (Default)

Averages embeddings across all chunks. Best for most use cases.

```
Chunk 1: [0.2, 0.4, 0.6]
Chunk 2: [0.4, 0.2, 0.8]
         ↓
Average: [(0.2+0.4)/2, (0.4+0.2)/2, (0.6+0.8)/2]
       = [0.3, 0.3, 0.7]
         ↓
Normalize to unit vector
```

**Pros:**
- Balanced representation of entire text
- Good semantic coverage
- Works well for diverse content

**Use when:**
- Content spans multiple topics
- Full document understanding needed
- General purpose (recommended default)

#### First

Uses only the first chunk's embedding. Fastest but loses information.

```
Chunk 1: [0.2, 0.4, 0.6] ← Use this
Chunk 2: [0.4, 0.2, 0.8] ← Ignore
         ↓
Result:  [0.2, 0.4, 0.6]
```

**Pros:**
- Fast (stops after first chunk)
- Emphasizes beginning of text
- Good for title/summary-heavy content

**Cons:**
- Loses later content information
- May miss important details

**Use when:**
- Most important info is at the start
- Performance is critical
- Content has strong opening summary

#### Max Pool

Takes maximum value for each dimension across all chunks.

```
Chunk 1: [0.2, 0.4, 0.6]
Chunk 2: [0.4, 0.2, 0.8]
         ↓
Max:     [max(0.2,0.4), max(0.4,0.2), max(0.6,0.8)]
       = [0.4, 0.4, 0.8]
         ↓
Normalize to unit vector
```

**Pros:**
- Preserves strongest signals
- Good for keyword-rich content
- Emphasizes distinct features

**Cons:**
- May over-emphasize outliers
- Less balanced than average

**Use when:**
- Looking for specific features/keywords
- Content has distinct sections
- Need to preserve strong signals

### Overlap Importance

Overlap preserves context at chunk boundaries:

```
Without overlap:
Chunk 1: "...authentication uses JWT tokens."
Chunk 2: "The token payload contains user..."
         ↑ Context lost between chunks

With overlap (200 chars):
Chunk 1: "...authentication uses JWT tokens. The token..."
Chunk 2: "...JWT tokens. The token payload contains user..."
         ↑ Context preserved
```

**Recommended overlap:** 200-400 characters (~50-100 tokens)

### Performance Implications

**Small chunk size (< 4000 chars):**
- ✅ Better memory efficiency
- ✅ Handles longer documents
- ❌ More API calls
- ❌ Slower embedding

**Large chunk size (> 12000 chars):**
- ✅ Fewer API calls
- ✅ Faster embedding
- ❌ May exceed model limits
- ❌ Higher memory usage

**Recommended:** 8000 chars (~2000 tokens for nomic-embed-text)

### Disabling Chunking

Set `chunk_size` to 0 to disable:

```yaml
embeddings:
  chunk_size: 0  # No chunking, embed full text
```

**Warning:** Disabling chunking may cause errors with long content that exceeds model context limits.

### Best Practices

1. **Default configuration works well** for most use cases
2. **Increase chunk_size** if you have mostly short content (< 8000 chars)
3. **Decrease chunk_size** if hitting memory limits or timeouts
4. **Use "first" strategy** for content with strong opening summaries
5. **Use "max_pool" strategy** for keyword-focused search
6. **Keep overlap** at 200-400 chars to preserve context

### Example Configuration by Use Case

**Long technical documents:**
```yaml
embeddings:
  chunk_size: 6000          # Smaller chunks for reliability
  chunk_overlap: 300        # More overlap for context
  chunk_strategy: average   # Balanced representation
```

**Short code snippets:**
```yaml
embeddings:
  chunk_size: 12000         # Larger chunks (rarely split)
  chunk_overlap: 100        # Less overlap needed
  chunk_strategy: average   # Standard approach
```

**Performance-critical:**
```yaml
embeddings:
  chunk_size: 10000         # Larger chunks = fewer calls
  chunk_overlap: 100        # Minimal overlap
  chunk_strategy: first     # Fastest strategy
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
# .agents/cortex/config.yaml
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

- [ARCHITECTURE.md](overview.md) - Embeddings architecture
- [CONFIGURATION.md](../guides/configuration.md) - Configuration options
- [STORAGE.md](storage.md) - Vector storage and indexing
- [DEVELOPMENT.md](../contributing/development.md) - Development setup
