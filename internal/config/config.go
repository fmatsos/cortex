// Package config provides configuration management for Cortex AI
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Config represents the complete configuration for Cortex AI
type Config struct {
	Storage    StorageConfig    `mapstructure:"storage"`
	Embeddings EmbeddingsConfig `mapstructure:"embeddings"`
	Search     SearchConfig     `mapstructure:"search"`
	Output     OutputConfig     `mapstructure:"output"`
}

// StorageConfig contains storage backend configuration
type StorageConfig struct {
	Backend string `mapstructure:"backend"` // gob | sqlite
	Path    string `mapstructure:"path"`    // data directory path
	Mode    string `mapstructure:"mode"`    // single | multi (single file vs one file per memory)
}

// EmbeddingsConfig contains embedding provider configuration
type EmbeddingsConfig struct {
	Provider string        `mapstructure:"provider"` // ollama
	Model    string        `mapstructure:"model"`    // nomic-embed-text
	Endpoint string        `mapstructure:"endpoint"` // http://localhost:11434
	Timeout  time.Duration `mapstructure:"timeout"`  // request timeout
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
			Provider: "ollama",
			Model:    "nomic-embed-text",
			Endpoint: "http://localhost:11434",
			Timeout:  30 * time.Second,
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
	}
}

// defaultDataPath returns the default data directory path
func defaultDataPath() string {
	// Check XDG_DATA_HOME first
	if xdgData := os.Getenv("XDG_DATA_HOME"); xdgData != "" {
		return filepath.Join(xdgData, "cortex-ai")
	}

	// Fall back to ~/.local/share
	home, err := os.UserHomeDir()
	if err != nil {
		return ".local/share/cortex-ai"
	}

	return filepath.Join(home, ".local", "share", "cortex-ai")
}

// defaultConfigPath returns the default config directory path
func defaultConfigPath() string {
	// Check XDG_CONFIG_HOME first
	if xdgConfig := os.Getenv("XDG_CONFIG_HOME"); xdgConfig != "" {
		return filepath.Join(xdgConfig, "cortex-ai")
	}

	// Fall back to ~/.config
	home, err := os.UserHomeDir()
	if err != nil {
		return ".config/cortex-ai"
	}

	return filepath.Join(home, ".config", "cortex-ai")
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
		m.v.AddConfigPath(defaultConfigPath())
		m.v.AddConfigPath(".")
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

	// Search
	_ = m.v.BindEnv("search.top_k", "CORTEX_SEARCH_TOP_K")
	_ = m.v.BindEnv("search.min_score", "CORTEX_SEARCH_MIN_SCORE")
	_ = m.v.BindEnv("search.include_obsolete", "CORTEX_SEARCH_INCLUDE_OBSOLETE")

	// Output
	_ = m.v.BindEnv("output.format", "CORTEX_OUTPUT_FORMAT")
	_ = m.v.BindEnv("output.colors", "CORTEX_OUTPUT_COLORS")
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

	// Search defaults
	m.v.SetDefault("search.top_k", defaults.Search.TopK)
	m.v.SetDefault("search.min_score", defaults.Search.MinScore)
	m.v.SetDefault("search.include_obsolete", defaults.Search.IncludeObsolete)

	// Output defaults
	m.v.SetDefault("output.format", defaults.Output.Format)
	m.v.SetDefault("output.colors", defaults.Output.Colors)
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
	content := `# Cortex AI Configuration
# See documentation for all options

storage:
  backend: gob                              # gob | sqlite
  path: ~/.local/share/cortex-ai
  mode: single                              # single | multi (single file vs one file per memory)

embeddings:
  provider: ollama
  model: nomic-embed-text
  endpoint: http://localhost:11434
  timeout: 30s

search:
  top_k: 5
  min_score: 0.5
  include_obsolete: false

output:
  format: text                              # text | json
  colors: true
`

	return os.WriteFile(configFile, []byte(content), 0644)
}

// Global config instance for easy access
var globalConfig *Config

// Initialize loads the global configuration
func Initialize(configFile string) error {
	manager := NewManager()
	if configFile != "" {
		manager.SetConfigFile(configFile)
	}

	cfg, err := manager.Load()
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
