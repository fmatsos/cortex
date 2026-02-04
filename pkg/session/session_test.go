package session

import (
	"testing"

	"github.com/cortex-ai/cortex-ai/internal/config"
)

func TestDeriveFromBranch_Prefix(t *testing.T) {
	tests := []struct {
		name        string
		cfg         *config.SessionConfig
		branch      string
		want        string
		wantErr     bool
	}{
		{
			name: "standard branch with two segments",
			cfg: &config.SessionConfig{
				PatternType: "prefix",
				Prefix:      "session-",
				Separator:   "-",
				MaxSegments: 2,
			},
			branch: "fix/sil-123/do-implementation",
			want:   "session-fix-sil-123",
		},
		{
			name: "branch with three segments, max 2",
			cfg: &config.SessionConfig{
				PatternType: "prefix",
				Prefix:      "session-",
				Separator:   "-",
				MaxSegments: 2,
			},
			branch: "feature/auth/jwt/implementation",
			want:   "session-feature-auth",
		},
		{
			name: "branch with no max segments",
			cfg: &config.SessionConfig{
				PatternType: "prefix",
				Prefix:      "session-",
				Separator:   "-",
				MaxSegments: 0,
			},
			branch: "feature/auth/jwt",
			want:   "session-feature-auth-jwt",
		},
		{
			name: "branch with custom prefix",
			cfg: &config.SessionConfig{
				PatternType: "prefix",
				Prefix:      "my-session-",
				Separator:   "-",
				MaxSegments: 2,
			},
			branch: "bugfix/critical/payment",
			want:   "my-session-bugfix-critical",
		},
		{
			name: "branch with custom separator",
			cfg: &config.SessionConfig{
				PatternType: "prefix",
				Prefix:      "session-",
				Separator:   "_",
				MaxSegments: 2,
			},
			branch: "hotfix/prod/database",
			want:   "session-hotfix_prod",
		},
		{
			name: "branch with strip prefix",
			cfg: &config.SessionConfig{
				PatternType: "prefix",
				Prefix:      "session-",
				Separator:   "-",
				MaxSegments: 2,
				StripPrefix: "release/",
			},
			branch: "release/v1.2.3/final",
			want:   "session-v1.2.3-final",
		},
		{
			name: "simple branch name without slashes",
			cfg: &config.SessionConfig{
				PatternType: "prefix",
				Prefix:      "session-",
				Separator:   "-",
				MaxSegments: 2,
			},
			branch: "main",
			want:   "session-main",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := NewDeriver(tt.cfg)
			got, err := d.DeriveFromBranch(tt.branch)
			if (err != nil) != tt.wantErr {
				t.Errorf("DeriveFromBranch() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("DeriveFromBranch() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestDeriveFromBranch_Regex(t *testing.T) {
	tests := []struct {
		name    string
		cfg     *config.SessionConfig
		branch  string
		want    string
		wantErr bool
	}{
		{
			name: "extract ticket number",
			cfg: &config.SessionConfig{
				PatternType: "regex",
				Pattern:     `^[^/]+/([\w-]+)`,
				Prefix:      "session-",
				Separator:   "-",
			},
			branch: "fix/sil-123/implementation",
			want:   "session-sil-123",
		},
		{
			name: "extract jira ticket",
			cfg: &config.SessionConfig{
				PatternType: "regex",
				Pattern:     `([A-Z]+-\d+)`,
				Prefix:      "session-",
				Separator:   "-",
			},
			branch: "feature/JIRA-456/add-auth",
			want:   "session-JIRA-456",
		},
		{
			name: "no match fallback to uuid",
			cfg: &config.SessionConfig{
				PatternType:    "regex",
				Pattern:        `ticket-(\d+)`,
				Prefix:         "session-",
				Separator:      "-",
				FallbackToUUID: true,
			},
			branch:  "main",
			wantErr: false, // Should not error, returns UUID
		},
		{
			name: "no match no fallback",
			cfg: &config.SessionConfig{
				PatternType:    "regex",
				Pattern:        `ticket-(\d+)`,
				Prefix:         "session-",
				Separator:      "-",
				FallbackToUUID: false,
			},
			branch:  "main",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := NewDeriver(tt.cfg)
			got, err := d.DeriveFromBranch(tt.branch)
			if (err != nil) != tt.wantErr {
				t.Errorf("DeriveFromBranch() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && tt.want != "" && got != tt.want {
				t.Errorf("DeriveFromBranch() = %v, want %v", got, tt.want)
			}
			// For UUID fallback case, just check it's not empty
			if !tt.wantErr && tt.want == "" && got == "" {
				t.Errorf("DeriveFromBranch() returned empty string, expected UUID")
			}
		})
	}
}

func TestDeriveFromBranch_Full(t *testing.T) {
	tests := []struct {
		name    string
		cfg     *config.SessionConfig
		branch  string
		want    string
		wantErr bool
	}{
		{
			name: "full branch name",
			cfg: &config.SessionConfig{
				PatternType: "full",
				Prefix:      "session-",
				Separator:   "-",
			},
			branch: "fix/sil-123/do-implementation",
			want:   "session-fix-sil-123-do-implementation",
		},
		{
			name: "full branch with custom separator",
			cfg: &config.SessionConfig{
				PatternType: "full",
				Prefix:      "session-",
				Separator:   "_",
			},
			branch: "feature/auth/jwt",
			want:   "session-feature_auth_jwt",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := NewDeriver(tt.cfg)
			got, err := d.DeriveFromBranch(tt.branch)
			if (err != nil) != tt.wantErr {
				t.Errorf("DeriveFromBranch() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("DeriveFromBranch() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestDeriveOrUseProvided(t *testing.T) {
	cfg := &config.SessionConfig{
		AutoDerive:  true,
		PatternType: "prefix",
		Prefix:      "session-",
		Separator:   "-",
		MaxSegments: 2,
	}

	d := NewDeriver(cfg)

	// Test with provided session ID
	provided := "my-custom-session"
	got, err := d.DeriveOrUseProvided(nil, provided)
	if err != nil {
		t.Errorf("DeriveOrUseProvided() error = %v", err)
	}
	if got != provided {
		t.Errorf("DeriveOrUseProvided() = %v, want %v", got, provided)
	}

	// Test with auto-derive disabled
	cfgNoAuto := &config.SessionConfig{
		AutoDerive: false,
	}
	dNoAuto := NewDeriver(cfgNoAuto)
	got, err = dNoAuto.DeriveOrUseProvided(nil, "")
	if err != nil {
		t.Errorf("DeriveOrUseProvided() error = %v", err)
	}
	if got != "" {
		t.Errorf("DeriveOrUseProvided() = %v, want empty string", got)
	}
}
