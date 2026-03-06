// Package config provides configuration management for Cortex
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Config represents the complete configuration for Cortex
type Config struct {
	Storage       StorageConfig       `mapstructure:"storage"`
	Embeddings    EmbeddingsConfig    `mapstructure:"embeddings"`
	Search        SearchConfig        `mapstructure:"search"`
	Output        OutputConfig        `mapstructure:"output"`
	Logging       LoggingConfig       `mapstructure:"logging"`
	Templates     TemplatesConfig     `mapstructure:"templates"`
	Consolidation ConsolidationConfig `mapstructure:"consolidation"`
	MCP           MCPConfig           `mapstructure:"mcp"`
	Autoprune     AutopruneConfig     `mapstructure:"autoprune"`
	Session       SessionConfig       `mapstructure:"session"`
	Hooks         HooksConfig         `mapstructure:"hooks"`
}

// LoggingConfig contains global logging configuration.
type LoggingConfig struct {
	Level      string `mapstructure:"level"`        // debug | info | warning | critical
	File       string `mapstructure:"file"`         // log file path
	MaxSizeMB  int    `mapstructure:"max_size_mb"`  // rotate after size in MB
	MaxBackups int    `mapstructure:"max_backups"`  // number of rotated files to keep
	MaxAgeDays int    `mapstructure:"max_age_days"` // max age in days for rotated files
	Compress   bool   `mapstructure:"compress"`     // gzip rotated files
}

// HooksConfig contains configuration for Claude Code hook scripts.
type HooksConfig struct {
	SessionStart HooksSessionStartConfig `mapstructure:"session_start"`
	Stop         HooksStopConfig         `mapstructure:"stop"`
	PreCompact   HooksPreCompactConfig   `mapstructure:"pre_compact"`
}

// HooksSessionStartConfig contains configuration for the SessionStart hook.
type HooksSessionStartConfig struct {
	// NotificationPrompt is appended after the memory counts line in session-start.sh.
	NotificationPrompt string `mapstructure:"notification_prompt"`
}

// HooksStopConfig contains configuration for the Stop hook.
type HooksStopConfig struct {
	// ReviewPrompt is shown to Claude on the first Stop event of each session.
	ReviewPrompt string `mapstructure:"review_prompt"`
}

// HooksPreCompactConfig contains configuration for the PreCompact hook.
type HooksPreCompactConfig struct {
	// SummaryPrompt is appended to the compaction instructions, asking Claude to
	// save a summary to working memory before context is truncated.
	SummaryPrompt string `mapstructure:"summary_prompt"`
}

// ConsolidationConfig contains configuration for memory consolidation
type ConsolidationConfig struct {
	SimilarityThreshold      float64 `mapstructure:"similarity_threshold"`         // threshold for duplicate detection
	PromptTemplate           string  `mapstructure:"prompt_template"`              // template name for LLM consolidation
	AutoTransferOnSessionEnd bool    `mapstructure:"auto_transfer_on_session_end"` // auto-transfer working to episodic
}

// MCPConfig contains configuration for MCP tools.
type MCPConfig struct {
	Prompts MCPPromptConfig `mapstructure:"prompts"`
}

// MCPPromptConfig contains prompt overrides for MCP decision-support tools.
type MCPPromptConfig struct {
	ChooseMemoryLayer          string `mapstructure:"choose_memory_layer"`
	ChooseWorkingConsolidation string `mapstructure:"choose_working_consolidation"`
	ReviewSession              string `mapstructure:"review_session"`
	MemoryMaintenance          string `mapstructure:"memory_maintenance"`
	TaskCompletion             string `mapstructure:"task_completion"`
}

// AutopruneConfig contains configuration for automatic memory cleanup
type AutopruneConfig struct {
	DuplicatesThreshold    float64 `mapstructure:"duplicates_threshold"`     // similarity threshold for duplicate detection
	EpisodicRetentionDays  int     `mapstructure:"episodic_retention_days"`  // days to retain episodic memories
	SemanticMergeThreshold float64 `mapstructure:"semantic_merge_threshold"` // threshold for merging semantic memories
}

// SessionConfig contains session ID derivation configuration
type SessionConfig struct {
	AutoDerive     bool   `mapstructure:"auto_derive"`      // automatically derive session ID from git branch
	PatternType    string `mapstructure:"pattern_type"`     // pattern type: prefix, regex, full
	Pattern        string `mapstructure:"pattern"`          // pattern to extract session ID from branch name
	Prefix         string `mapstructure:"prefix"`           // prefix to add to derived session ID (default: "session-")
	Separator      string `mapstructure:"separator"`        // separator to use when transforming branch name (default: "-")
	MaxSegments    int    `mapstructure:"max_segments"`     // max number of segments to include (0 = all)
	StripPrefix    string `mapstructure:"strip_prefix"`     // optional prefix to strip from branch name before processing
	FallbackToUUID bool   `mapstructure:"fallback_to_uuid"` // fallback to UUID if pattern doesn't match
}

// TemplatesConfig contains template customization options
type TemplatesConfig struct {
	Markdown *MarkdownTemplateConfig `mapstructure:"markdown" json:"markdown,omitempty" yaml:"markdown,omitempty"`
}

// MarkdownTemplateConfig represents Markdown export template configuration
type MarkdownTemplateConfig struct {
	Memory    *MemoryTemplateConfig    `mapstructure:"memory" json:"memory,omitempty" yaml:"memory,omitempty"`
	Synthesis *SynthesisTemplateConfig `mapstructure:"synthesis" json:"synthesis,omitempty" yaml:"synthesis,omitempty"`
}

// MemoryTemplateConfig represents the template config for single memory export
type MemoryTemplateConfig struct {
	Frontmatter *FrontmatterTemplateConfig `mapstructure:"frontmatter" json:"frontmatter,omitempty" yaml:"frontmatter,omitempty"`
	Body        string                     `mapstructure:"body" json:"body,omitempty" yaml:"body,omitempty"`
}

// FrontmatterTemplateConfig represents frontmatter template options
type FrontmatterTemplateConfig struct {
	IncludeID       *bool  `mapstructure:"include_id" json:"include_id,omitempty" yaml:"include_id,omitempty"`
	IncludeDates    *bool  `mapstructure:"include_dates" json:"include_dates,omitempty" yaml:"include_dates,omitempty"`
	IncludeMetadata *bool  `mapstructure:"include_metadata" json:"include_metadata,omitempty" yaml:"include_metadata,omitempty"`
	DateFormat      string `mapstructure:"date_format" json:"date_format,omitempty" yaml:"date_format,omitempty"`
}

// SynthesisTemplateConfig represents the template config for synthesis export
type SynthesisTemplateConfig struct {
	Frontmatter      *FrontmatterTemplateConfig `mapstructure:"frontmatter" json:"frontmatter,omitempty" yaml:"frontmatter,omitempty"`
	Header           string                     `mapstructure:"header" json:"header,omitempty" yaml:"header,omitempty"`
	SummarySection   *SectionTemplateConfig     `mapstructure:"summary_section" json:"summary_section,omitempty" yaml:"summary_section,omitempty"`
	LearningsSection *LearningsTemplateConfig   `mapstructure:"learnings_section" json:"learnings_section,omitempty" yaml:"learnings_section,omitempty"`
	Footer           string                     `mapstructure:"footer" json:"footer,omitempty" yaml:"footer,omitempty"`
}

// SectionTemplateConfig represents a template section
type SectionTemplateConfig struct {
	Title   string `mapstructure:"title" json:"title,omitempty" yaml:"title,omitempty"`
	Content string `mapstructure:"content" json:"content,omitempty" yaml:"content,omitempty"`
}

// LearningsTemplateConfig represents the learnings section config
type LearningsTemplateConfig struct {
	Title                string `mapstructure:"title" json:"title,omitempty" yaml:"title,omitempty"`
	ItemTemplate         string `mapstructure:"item_template" json:"item_template,omitempty" yaml:"item_template,omitempty"`
	ContentPreviewLength int    `mapstructure:"content_preview_length" json:"content_preview_length,omitempty" yaml:"content_preview_length,omitempty"`
}

// DefaultMarkdownTemplateConfig returns the default Markdown template configuration
func DefaultMarkdownTemplateConfig() *MarkdownTemplateConfig {
	includeTrue := true
	return &MarkdownTemplateConfig{
		Memory: &MemoryTemplateConfig{
			Frontmatter: &FrontmatterTemplateConfig{
				IncludeID:       &includeTrue,
				IncludeDates:    &includeTrue,
				IncludeMetadata: &includeTrue,
				DateFormat:      "2006-01-02T15:04:05Z07:00",
			},
			Body: "{{.Content}}",
		},
		Synthesis: &SynthesisTemplateConfig{
			Frontmatter: &FrontmatterTemplateConfig{
				DateFormat: "2006-01-02T15:04:05Z07:00",
			},
			Header: "# {{.Intent | title}} - Synthesis\n\nThis document synthesizes {{len .Results}} memories related to \"{{.Intent}}\".",
			SummarySection: &SectionTemplateConfig{
				Title:   "## Summary",
				Content: "Based on the stored memories, the following information was found:",
			},
			LearningsSection: &LearningsTemplateConfig{
				Title:                "## Key Learnings",
				ItemTemplate:         "### From: {{.Title}} (score: {{printf \"%.2f\" .Score}})\n\n{{.Preview}}",
				ContentPreviewLength: 500,
			},
			Footer: "---\n\n*Generated by Cortex - This is a read-only synthesis, not importable.*",
		},
	}
}

// StorageConfig contains storage backend configuration
type StorageConfig struct {
	Backend string `mapstructure:"backend"` // gob (default, no CGO) | lancedb (requires -tags lancedb)
	Path    string `mapstructure:"path"`    // data directory path
	Mode    string `mapstructure:"mode"`    // single | multi (single file vs one file per memory)
}

// EmbeddingsConfig contains embedding provider configuration
type EmbeddingsConfig struct {
	Provider      string        `mapstructure:"provider"`       // ollama
	Model         string        `mapstructure:"model"`          // nomic-embed-text
	Endpoint      string        `mapstructure:"endpoint"`       // http://localhost:11434
	Timeout       time.Duration `mapstructure:"timeout"`        // request timeout
	ChunkSize     int           `mapstructure:"chunk_size"`     // max chars per chunk (0 = no chunking)
	ChunkOverlap  int           `mapstructure:"chunk_overlap"`  // overlap between chunks
	ChunkStrategy string        `mapstructure:"chunk_strategy"` // how to combine embeddings: average, first, max_pool
}

// SearchConfig contains search defaults
type SearchConfig struct {
	TopK            int     `mapstructure:"top_k"`            // default number of results
	MinScore        float64 `mapstructure:"min_score"`        // default minimum similarity
	IncludeObsolete bool    `mapstructure:"include_obsolete"` // include obsolete by default
}

// OutputConfig contains output formatting options
type OutputConfig struct {
	Format string `mapstructure:"format"` // text | json
	Colors bool   `mapstructure:"colors"` // colorized output
}

// DefaultConfig returns the default configuration
func DefaultConfig() *Config {
	return &Config{
		Storage: StorageConfig{
			Backend: "gob",
			Path:    defaultDataPath(),
			Mode:    "single",
		},
		Embeddings: EmbeddingsConfig{
			Provider:      "ollama",
			Model:         "nomic-embed-text",
			Endpoint:      "http://localhost:11434",
			Timeout:       30 * time.Second,
			ChunkSize:     8000,      // ~2000 tokens for nomic-embed-text
			ChunkOverlap:  200,       // 200 char overlap to preserve context
			ChunkStrategy: "average", // average embeddings across chunks
		},
		Search: SearchConfig{
			TopK:            5,
			MinScore:        0.5,
			IncludeObsolete: false,
		},
		Output: OutputConfig{
			Format: "text",
			Colors: true,
		},
		Logging: LoggingConfig{
			Level:      "info",
			File:       filepath.Join(defaultBasePath(), "logs", "cortex.log"),
			MaxSizeMB:  10,
			MaxBackups: 5,
			MaxAgeDays: 30,
			Compress:   true,
		},
		Consolidation: ConsolidationConfig{
			SimilarityThreshold:      0.85,
			PromptTemplate:           "default",
			AutoTransferOnSessionEnd: true,
		},
		MCP: MCPConfig{
			Prompts: MCPPromptConfig{
				ChooseMemoryLayer:          defaultChooseMemoryLayerPrompt(),
				ChooseWorkingConsolidation: defaultChooseWorkingConsolidationPrompt(),
				ReviewSession:              defaultReviewSessionPrompt(),
				MemoryMaintenance:          defaultMemoryMaintenancePrompt(),
				TaskCompletion:             defaultTaskCompletionPrompt(),
			},
		},
		Autoprune: AutopruneConfig{
			DuplicatesThreshold:    0.92,
			EpisodicRetentionDays:  90,
			SemanticMergeThreshold: 0.88,
		},
		Session: SessionConfig{
			AutoDerive:     true,
			PatternType:    "prefix",
			Pattern:        "",
			Prefix:         "session-",
			Separator:      "-",
			MaxSegments:    2,
			StripPrefix:    "",
			FallbackToUUID: true,
		},
		Hooks: HooksConfig{
			SessionStart: HooksSessionStartConfig{
				NotificationPrompt: defaultHooksSessionStartNotificationPrompt(),
			},
			Stop: HooksStopConfig{
				ReviewPrompt: defaultHooksStopReviewPrompt(),
			},
			PreCompact: HooksPreCompactConfig{
				SummaryPrompt: defaultHooksPreCompactSummaryPrompt(),
			},
		},
	}
}

func defaultHooksSessionStartNotificationPrompt() string {
	return "Working memories for this session are listed above. " +
		"Use 'cortex get <id>' to load the full content of any relevant memory. " +
		"Use 'cortex list --level <semantic|episodic|working>' or 'cortex search \"<query>\"' to retrieve additional context as needed."
}

func defaultHooksStopReviewPrompt() string {
	return "Memory review: Please save any relevant context from this session to working memory first " +
		"using 'cortex consolidate --level working --session $SESSION_ID --content \"...\"'. " +
		"Then consolidate to episodic memory any completed work, decisions, or outcomes worth keeping in history " +
		"using 'cortex consolidate --level episodic --content \"...\"'. " +
		"Do NOT write directly to semantic memory here — semantic consolidation happens separately via memory maintenance. " +
		"Use 'cortex delete <id>' to remove obsolete memories. " +
		"When done, your next response will end the session normally."
}

func defaultHooksPreCompactSummaryPrompt() string {
	return "Before compacting: please save a summary of this conversation to Cortex working memory using " +
		"'cortex consolidate --level working --content \"Session summary: <what was accomplished, decisions made, current state, open questions>\"'. " +
		"This preserves context across compaction."
}

func defaultChooseMemoryLayerPrompt() string {
	return `You are selecting the correct Cortex memory layer for a new memory.

Choose exactly one: working, episodic, semantic.

Guidelines:
- working: temporary session context, active tasks, scratch notes. Requires session_id.
- episodic: time-bound events/decisions/outcomes useful for historical recall.
- semantic: durable, reusable knowledge or conventions that should persist.

Return JSON only:
{"level":"working|episodic|semantic","rationale":"short reason","needs_session_id":true|false}`
}

func defaultChooseWorkingConsolidationPrompt() string {
	return `You are selecting which working memories should be consolidated.

Pick entries that capture completed work, decisions, or knowledge that should persist.
Exclude transient notes that are only useful during the session.

Target level must be episodic. Working memories are promoted to episodic here.
Semantic consolidation happens separately during memory maintenance, not here.

Return JSON only:
{"selected_ids":["id1","id2"],"rationale":"short reason","suggested_level":"episodic"}`
}

func defaultReviewSessionPrompt() string {
	return `You are reviewing working memories from a completed session.
For each memory, decide what action to take:

- promote_episodic: Valuable time-bound event, decision, or outcome worth keeping in history.
- mark_obsolete: Outdated, incorrect, or no longer relevant.
- keep: Still active/relevant for ongoing work, leave as working.

IMPORTANT: Do NOT promote directly to semantic. Semantic memories are created separately
during periodic memory maintenance (cortex_think_about_memory_maintenance) once enough
episodic evidence has accumulated.

Consider:
1. Does this capture a time-bound event or decision from this session?
2. Is the information still accurate and relevant?
3. Would this be useful for future sessions as historical context?

Return JSON only:
{"actions":[{"memory_id":"id","action":"promote_episodic|mark_obsolete|keep","rationale":"short reason"}],"session_summary":"brief summary of session outcomes"}`
}

func defaultMemoryMaintenancePrompt() string {
	return `You are performing maintenance on the Cortex memory store.
Review the memories below and identify actions to improve memory quality:

Possible actions:
- mark_obsolete: Memory is outdated, superseded, or no longer accurate.
- promote: Episodic memory that has proven to be durable knowledge; promote to semantic.
- update: Memory content is partially correct but needs revision.
- merge_candidate: Two or more memories cover the same topic and should be consolidated.
- no_action: Memory is fine as-is.

Priorities:
1. Accuracy: Flag memories with outdated or incorrect information.
2. Deduplication: Identify memories that overlap significantly.
3. Promotion: Find episodic memories that represent lasting knowledge.
4. Cleanup: Mark truly obsolete memories.

Return JSON only:
{"actions":[{"memory_id":"id","action":"mark_obsolete|promote|update|merge_candidate|no_action","rationale":"short reason","merge_with":"other_id (only for merge_candidate)","suggested_content":"new content (only for update)"}],"summary":"brief maintenance summary"}`
}

func defaultTaskCompletionPrompt() string {
	return `You have just completed a task. Reflect on what was accomplished and identify knowledge worth preserving.

Consider:
1. What decisions were made and why?
2. What problems were encountered and how were they solved?
3. What patterns, conventions, or best practices were discovered?
4. What would be useful to remember for similar future tasks?

Memory layer rules:
- working: current session context, active tasks, scratch notes (requires session_id).
- episodic: time-bound events, decisions, and outcomes from this task. Use for anything that happened.
- semantic: ONLY for patterns or conventions with strong episodic backing already present.
  Prefer episodic; promote to semantic via maintenance only after multiple confirming episodes.

For each piece of knowledge, suggest:
- level: working (session notes) or episodic (task events/decisions). Use semantic sparingly.
- title: concise title for the memory.
- content: detailed content to store.
- tags: relevant tags for categorization.

Return JSON only:
{"memories_to_create":[{"level":"working|episodic|semantic","title":"concise title","content":"detailed content","tags":["tag1","tag2"]}],"rationale":"why these memories are valuable"}`
}

// defaultBasePath returns the default base directory for all Cortex data
// Uses .agents/cortex in the current directory (project-local storage)
// Can be overridden via CORTEX_BASE_PATH environment variable
func defaultBasePath() string {
	if basePath := os.Getenv("CORTEX_BASE_PATH"); basePath != "" {
		return basePath
	}
	return filepath.Join(".agents", "cortex")
}

// defaultDataPath returns the default data directory path
func defaultDataPath() string {
	return defaultBasePath()
}

// defaultConfigPath returns the default config directory path
func defaultConfigPath() string {
	return defaultBasePath()
}

// ConfigFilePath returns the path to the config file
func ConfigFilePath() string {
	return filepath.Join(defaultConfigPath(), "config.yaml")
}

// Manager handles configuration loading and management
type Manager struct {
	v       *viper.Viper
	config  *Config
	cfgFile string
}

// NewManager creates a new configuration manager
func NewManager() *Manager {
	return &Manager{
		v:      viper.New(),
		config: DefaultConfig(),
	}
}

// SetConfigFile sets a custom config file path
func (m *Manager) SetConfigFile(path string) {
	m.cfgFile = path
}

// Load loads the configuration from all sources
// Priority (highest to lowest): CLI flags > Environment > Config file > Defaults
func (m *Manager) Load() (*Config, error) {
	// Set config name and type
	m.v.SetConfigName("config")
	m.v.SetConfigType("yaml")

	// Set config search paths
	if m.cfgFile != "" {
		m.v.SetConfigFile(m.cfgFile)
	} else {
		m.v.AddConfigPath(defaultConfigPath()) // .agents/cortex
		m.v.AddConfigPath(".")                 // current directory
	}

	// Set up environment variable binding
	m.v.SetEnvPrefix("CORTEX")
	m.v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	m.v.AutomaticEnv()

	// Bind specific environment variables
	m.bindEnvVars()

	// Set defaults
	m.setDefaults()

	// Read config file (if exists)
	if err := m.v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("error reading config file: %w", err)
		}
		// Config file not found is OK, we use defaults
	}

	// Unmarshal into config struct
	if err := m.v.Unmarshal(m.config); err != nil {
		return nil, fmt.Errorf("error parsing config: %w", err)
	}

	return m.config, nil
}

// bindEnvVars binds environment variables to config keys
func (m *Manager) bindEnvVars() {
	// Storage
	_ = m.v.BindEnv("storage.backend", "CORTEX_STORAGE_BACKEND")
	_ = m.v.BindEnv("storage.path", "CORTEX_STORAGE_PATH")
	_ = m.v.BindEnv("storage.mode", "CORTEX_STORAGE_MODE")

	// Embeddings
	_ = m.v.BindEnv("embeddings.provider", "CORTEX_EMBEDDINGS_PROVIDER")
	_ = m.v.BindEnv("embeddings.model", "CORTEX_EMBEDDINGS_MODEL")
	_ = m.v.BindEnv("embeddings.endpoint", "CORTEX_EMBEDDINGS_ENDPOINT")
	_ = m.v.BindEnv("embeddings.timeout", "CORTEX_EMBEDDINGS_TIMEOUT")
	_ = m.v.BindEnv("embeddings.chunk_size", "CORTEX_EMBEDDINGS_CHUNK_SIZE")
	_ = m.v.BindEnv("embeddings.chunk_overlap", "CORTEX_EMBEDDINGS_CHUNK_OVERLAP")
	_ = m.v.BindEnv("embeddings.chunk_strategy", "CORTEX_EMBEDDINGS_CHUNK_STRATEGY")

	// Search
	_ = m.v.BindEnv("search.top_k", "CORTEX_SEARCH_TOP_K")
	_ = m.v.BindEnv("search.min_score", "CORTEX_SEARCH_MIN_SCORE")
	_ = m.v.BindEnv("search.include_obsolete", "CORTEX_SEARCH_INCLUDE_OBSOLETE")

	// Output
	_ = m.v.BindEnv("output.format", "CORTEX_OUTPUT_FORMAT")
	_ = m.v.BindEnv("output.colors", "CORTEX_OUTPUT_COLORS")

	// Logging
	_ = m.v.BindEnv("logging.level", "CORTEX_LOGGING_LEVEL")
	_ = m.v.BindEnv("logging.file", "CORTEX_LOGGING_FILE")
	_ = m.v.BindEnv("logging.max_size_mb", "CORTEX_LOGGING_MAX_SIZE_MB")
	_ = m.v.BindEnv("logging.max_backups", "CORTEX_LOGGING_MAX_BACKUPS")
	_ = m.v.BindEnv("logging.max_age_days", "CORTEX_LOGGING_MAX_AGE_DAYS")
	_ = m.v.BindEnv("logging.compress", "CORTEX_LOGGING_COMPRESS")

	// Consolidation
	_ = m.v.BindEnv("consolidation.similarity_threshold", "CORTEX_CONSOLIDATION_SIMILARITY_THRESHOLD")
	_ = m.v.BindEnv("consolidation.prompt_template", "CORTEX_CONSOLIDATION_PROMPT_TEMPLATE")
	_ = m.v.BindEnv("consolidation.auto_transfer_on_session_end", "CORTEX_CONSOLIDATION_AUTO_TRANSFER")

	// Autoprune
	_ = m.v.BindEnv("autoprune.duplicates_threshold", "CORTEX_AUTOPRUNE_DUPLICATES_THRESHOLD")
	_ = m.v.BindEnv("autoprune.episodic_retention_days", "CORTEX_AUTOPRUNE_EPISODIC_RETENTION_DAYS")
	_ = m.v.BindEnv("autoprune.semantic_merge_threshold", "CORTEX_AUTOPRUNE_SEMANTIC_MERGE_THRESHOLD")

	// Session
	_ = m.v.BindEnv("session.auto_derive", "CORTEX_SESSION_AUTO_DERIVE")
	_ = m.v.BindEnv("session.pattern_type", "CORTEX_SESSION_PATTERN_TYPE")
	_ = m.v.BindEnv("session.pattern", "CORTEX_SESSION_PATTERN")
	_ = m.v.BindEnv("session.prefix", "CORTEX_SESSION_PREFIX")
	_ = m.v.BindEnv("session.separator", "CORTEX_SESSION_SEPARATOR")
	_ = m.v.BindEnv("session.max_segments", "CORTEX_SESSION_MAX_SEGMENTS")
	_ = m.v.BindEnv("session.strip_prefix", "CORTEX_SESSION_STRIP_PREFIX")
	_ = m.v.BindEnv("session.fallback_to_uuid", "CORTEX_SESSION_FALLBACK_TO_UUID")

	// Hooks
	_ = m.v.BindEnv("hooks.session_start.notification_prompt", "CORTEX_HOOKS_SESSION_START_NOTIFICATION_PROMPT")
	_ = m.v.BindEnv("hooks.stop.review_prompt", "CORTEX_HOOKS_STOP_REVIEW_PROMPT")
	_ = m.v.BindEnv("hooks.pre_compact.summary_prompt", "CORTEX_HOOKS_PRE_COMPACT_SUMMARY_PROMPT")
}

// setDefaults sets default values
func (m *Manager) setDefaults() {
	defaults := DefaultConfig()

	// Storage defaults
	m.v.SetDefault("storage.backend", defaults.Storage.Backend)
	m.v.SetDefault("storage.path", defaults.Storage.Path)
	m.v.SetDefault("storage.mode", defaults.Storage.Mode)

	// Embeddings defaults
	m.v.SetDefault("embeddings.provider", defaults.Embeddings.Provider)
	m.v.SetDefault("embeddings.model", defaults.Embeddings.Model)
	m.v.SetDefault("embeddings.endpoint", defaults.Embeddings.Endpoint)
	m.v.SetDefault("embeddings.timeout", defaults.Embeddings.Timeout)
	m.v.SetDefault("embeddings.chunk_size", defaults.Embeddings.ChunkSize)
	m.v.SetDefault("embeddings.chunk_overlap", defaults.Embeddings.ChunkOverlap)
	m.v.SetDefault("embeddings.chunk_strategy", defaults.Embeddings.ChunkStrategy)

	// Search defaults
	m.v.SetDefault("search.top_k", defaults.Search.TopK)
	m.v.SetDefault("search.min_score", defaults.Search.MinScore)
	m.v.SetDefault("search.include_obsolete", defaults.Search.IncludeObsolete)

	// Output defaults
	m.v.SetDefault("output.format", defaults.Output.Format)
	m.v.SetDefault("output.colors", defaults.Output.Colors)

	// Logging defaults
	m.v.SetDefault("logging.level", defaults.Logging.Level)
	m.v.SetDefault("logging.file", defaults.Logging.File)
	m.v.SetDefault("logging.max_size_mb", defaults.Logging.MaxSizeMB)
	m.v.SetDefault("logging.max_backups", defaults.Logging.MaxBackups)
	m.v.SetDefault("logging.max_age_days", defaults.Logging.MaxAgeDays)
	m.v.SetDefault("logging.compress", defaults.Logging.Compress)

	// Consolidation defaults
	m.v.SetDefault("consolidation.similarity_threshold", defaults.Consolidation.SimilarityThreshold)
	m.v.SetDefault("consolidation.prompt_template", defaults.Consolidation.PromptTemplate)
	m.v.SetDefault("consolidation.auto_transfer_on_session_end", defaults.Consolidation.AutoTransferOnSessionEnd)

	// MCP defaults
	m.v.SetDefault("mcp.prompts.choose_memory_layer", defaults.MCP.Prompts.ChooseMemoryLayer)
	m.v.SetDefault("mcp.prompts.choose_working_consolidation", defaults.MCP.Prompts.ChooseWorkingConsolidation)
	m.v.SetDefault("mcp.prompts.review_session", defaults.MCP.Prompts.ReviewSession)
	m.v.SetDefault("mcp.prompts.memory_maintenance", defaults.MCP.Prompts.MemoryMaintenance)
	m.v.SetDefault("mcp.prompts.task_completion", defaults.MCP.Prompts.TaskCompletion)

	// Autoprune defaults
	m.v.SetDefault("autoprune.duplicates_threshold", defaults.Autoprune.DuplicatesThreshold)
	m.v.SetDefault("autoprune.episodic_retention_days", defaults.Autoprune.EpisodicRetentionDays)
	m.v.SetDefault("autoprune.semantic_merge_threshold", defaults.Autoprune.SemanticMergeThreshold)

	// Session defaults
	m.v.SetDefault("session.auto_derive", defaults.Session.AutoDerive)
	m.v.SetDefault("session.pattern_type", defaults.Session.PatternType)
	m.v.SetDefault("session.pattern", defaults.Session.Pattern)
	m.v.SetDefault("session.prefix", defaults.Session.Prefix)
	m.v.SetDefault("session.separator", defaults.Session.Separator)
	m.v.SetDefault("session.max_segments", defaults.Session.MaxSegments)
	m.v.SetDefault("session.strip_prefix", defaults.Session.StripPrefix)
	m.v.SetDefault("session.fallback_to_uuid", defaults.Session.FallbackToUUID)

	// Hooks defaults
	m.v.SetDefault("hooks.session_start.notification_prompt", defaults.Hooks.SessionStart.NotificationPrompt)
	m.v.SetDefault("hooks.stop.review_prompt", defaults.Hooks.Stop.ReviewPrompt)
	m.v.SetDefault("hooks.pre_compact.summary_prompt", defaults.Hooks.PreCompact.SummaryPrompt)
}

// Get returns the current configuration
func (m *Manager) Get() *Config {
	return m.config
}

// Set sets a configuration value
func (m *Manager) Set(key string, value interface{}) {
	m.v.Set(key, value)
}

// GetString gets a string value by key
func (m *Manager) GetString(key string) string {
	return m.v.GetString(key)
}

// GetInt gets an int value by key
func (m *Manager) GetInt(key string) int {
	return m.v.GetInt(key)
}

// GetFloat64 gets a float64 value by key
func (m *Manager) GetFloat64(key string) float64 {
	return m.v.GetFloat64(key)
}

// GetBool gets a bool value by key
func (m *Manager) GetBool(key string) bool {
	return m.v.GetBool(key)
}

// AllSettings returns all settings as a map
func (m *Manager) AllSettings() map[string]interface{} {
	return m.v.AllSettings()
}

// ConfigFileUsed returns the path of the config file used
func (m *Manager) ConfigFileUsed() string {
	return m.v.ConfigFileUsed()
}

// WriteConfig writes the current configuration to file
func (m *Manager) WriteConfig() error {
	configPath := defaultConfigPath()

	// Ensure config directory exists
	if err := os.MkdirAll(configPath, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	configFile := filepath.Join(configPath, "config.yaml")
	return m.v.WriteConfigAs(configFile)
}

// WriteDefaultConfig creates a default config file if it doesn't exist
func WriteDefaultConfig() error {
	configFile := ConfigFilePath()

	// Check if file already exists
	if _, err := os.Stat(configFile); err == nil {
		return nil // File exists, don't overwrite
	}

	// Ensure config directory exists
	configDir := filepath.Dir(configFile)
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	// Create default config content
	content := `# Cortex Configuration
# See documentation for all options

storage:
  backend: gob                              # gob | sqlite
  path: .agents/cortex                          # project-local storage
  mode: single                              # single | multi (single file vs one file per memory)

embeddings:
  provider: ollama
  model: nomic-embed-text
  endpoint: http://localhost:11434
  timeout: 30s
  chunk_size: 8000                          # max chars per chunk (0 = no chunking)
  chunk_overlap: 200                        # overlap between chunks for context
  chunk_strategy: average                   # average | first | max_pool

search:
  top_k: 5
  min_score: 0.5
  include_obsolete: false

output:
  format: text                              # text | json
  colors: true

logging:
  level: info                               # debug | info | warning | critical
  file: .agents/cortex/logs/cortex.log      # rotating log file path
  max_size_mb: 10                           # rotate after this size in MB
  max_backups: 5                            # number of rotated files to keep
  max_age_days: 30                          # days to retain rotated files
  compress: true                            # gzip rotated files

session:
  auto_derive: true                         # automatically derive session ID from git branch
  pattern_type: prefix                      # pattern type: prefix, regex, full
  pattern: ""                               # regex pattern (only for pattern_type: regex)
  prefix: "session-"                        # prefix to add to derived session ID
  separator: "-"                            # separator for branch name parts
  max_segments: 2                           # max number of branch segments (0 = all)
  strip_prefix: ""                          # optional prefix to strip from branch
  fallback_to_uuid: true                    # fallback to UUID if pattern doesn't match
`

	return os.WriteFile(configFile, []byte(content), 0644)
}

// Global config instance for easy access
var globalConfig *Config
var globalManager *Manager

// Initialize loads the global configuration
func Initialize(configFile string) error {
	globalManager = NewManager()
	if configFile != "" {
		globalManager.SetConfigFile(configFile)
	}

	cfg, err := globalManager.Load()
	if err != nil {
		return err
	}

	globalConfig = cfg
	return nil
}

// Global returns the global configuration
func Global() *Config {
	if globalConfig == nil {
		globalConfig = DefaultConfig()
	}
	return globalConfig
}

// GlobalManager returns the global configuration manager
func GlobalManager() *Manager {
	return globalManager
}

// GlobalConfigFileUsed returns the path of the config file that was loaded
// Returns empty string if no config file was loaded (using defaults)
func GlobalConfigFileUsed() string {
	if globalManager == nil {
		return ""
	}
	return globalManager.ConfigFileUsed()
}
