package storage

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// ZvecProcess manages the zvec Python sidecar process.
type ZvecProcess struct {
	cmd       *exec.Cmd
	port      int
	dataDir   string
	dimension int
}

// NewZvecProcess creates a new ZvecProcess manager.
// A port of 0 means a free port is chosen automatically.
func NewZvecProcess(dataDir string, port int, dimension int) *ZvecProcess {
	return &ZvecProcess{
		dataDir:   dataDir,
		port:      port,
		dimension: dimension,
	}
}

// Start launches the zvec sidecar and waits until it is ready to accept requests.
func (p *ZvecProcess) Start() error {
	if p.port == 0 {
		free, err := findFreePort()
		if err != nil {
			return fmt.Errorf("failed to find free port: %w", err)
		}
		p.port = free
	}

	// Resolve to an absolute path to avoid relative-path surprises and to
	// ensure the argument passed to the subprocess is unambiguous.
	absDataDir, err := filepath.Abs(p.dataDir)
	if err != nil {
		return fmt.Errorf("failed to resolve data dir: %w", err)
	}
	p.dataDir = absDataDir

	scriptPath, err := p.sidecarPath()
	if err != nil {
		return err
	}

	p.cmd = exec.Command( //nolint:gosec
		"python3", scriptPath,
		"--port", fmt.Sprintf("%d", p.port),
		"--data-dir", p.dataDir,
		"--dimension", fmt.Sprintf("%d", p.dimension),
	)
	p.cmd.Stderr = os.Stderr

	if err := p.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start zvec sidecar: %w", err)
	}

	return p.waitReady(30 * time.Second)
}

// Stop terminates the zvec sidecar process.
func (p *ZvecProcess) Stop() error {
	if p.cmd == nil || p.cmd.Process == nil {
		return nil
	}
	if err := p.cmd.Process.Kill(); err != nil {
		return fmt.Errorf("failed to kill zvec process: %w", err)
	}
	_ = p.cmd.Wait()
	return nil
}

// Port returns the port the sidecar is listening on.
func (p *ZvecProcess) Port() int {
	return p.port
}

// BaseURL returns the base HTTP URL of the sidecar.
func (p *ZvecProcess) BaseURL() string {
	return fmt.Sprintf("http://127.0.0.1:%d", p.port)
}

// sidecarPath returns the path to zvec-server.py.
// It searches in the following order:
//  1. CORTEX_ZVEC_SERVER environment variable (explicit override)
//  2. Same directory as the current executable
//  3. {exec_dir}/../bin/zvec-server.py (installed next to binary)
//  4. ./bin/zvec-server.py (development working directory)
func (p *ZvecProcess) sidecarPath() (string, error) {
	if env := os.Getenv("CORTEX_ZVEC_SERVER"); env != "" {
		if _, err := os.Stat(env); err == nil {
			return env, nil
		}
		return "", fmt.Errorf("CORTEX_ZVEC_SERVER=%q does not exist", env)
	}

	var candidates []string
	if execPath, err := os.Executable(); err == nil {
		dir := filepath.Dir(execPath)
		candidates = append(candidates,
			filepath.Join(dir, "zvec-server.py"),
			filepath.Join(dir, "..", "bin", "zvec-server.py"),
		)
	}
	candidates = append(candidates, filepath.Join("bin", "zvec-server.py"))

	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c, nil
		}
	}

	return "", fmt.Errorf(
		"zvec-server.py not found; install it alongside the cortex binary or set CORTEX_ZVEC_SERVER",
	)
}

// waitReady polls the /health endpoint until the sidecar responds or the timeout elapses.
func (p *ZvecProcess) waitReady(timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	url := p.BaseURL() + "/health"
	client := &http.Client{Timeout: 2 * time.Second}

	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return err
		}
		resp, err := client.Do(req)
		if err == nil && resp.StatusCode == http.StatusOK {
			_ = resp.Body.Close()
			return nil
		}
		if resp != nil {
			_ = resp.Body.Close()
		}

		select {
		case <-ctx.Done():
			return fmt.Errorf("zvec sidecar did not become ready within %s", timeout)
		case <-time.After(200 * time.Millisecond):
		}
	}
}

// findFreePort returns a free TCP port on localhost.
func findFreePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer func() { _ = l.Close() }()
	return l.Addr().(*net.TCPAddr).Port, nil
}
