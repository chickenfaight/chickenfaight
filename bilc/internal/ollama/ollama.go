package ollama

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"time"
)

const address = "127.0.0.1:11434" // default ollama API address

// Service owns only an Ollama process started by BILC. For an existing
// service, stop and done are nil and Close leaves that service alone.
type Service struct {
	stop context.CancelFunc
	done chan struct{}
	err  error // Written before done is closed; read-only after receiving done.
}

// Ensure reuses local Ollama or starts the installed executable. The context
// controls the owned process for its entire lifetime, not just startup.
func Ensure(ctx context.Context) (*Service, error) {
	return ensure(ctx, "http://"+address, 15*time.Second, func(ctx context.Context) *exec.Cmd {
		cmd := exec.CommandContext(ctx, "ollama", "serve")
		// Keep the managed service local, regardless of inherited OLLAMA_HOST.
		// Other settings, including OLLAMA_MODELS, are inherited normally.
		cmd.Env = append(cmd.Environ(), "OLLAMA_HOST="+address)
		return cmd
	})
}

func ensure(ctx context.Context, baseURL string, timeout time.Duration, command func(context.Context) *exec.Cmd) (*Service, error) {
	readyCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	transport := &http.Transport{} // No proxy for the local readiness check.
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport: transport,
		Timeout:   500 * time.Millisecond,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	ready, err := reachable(readyCtx, client, baseURL)
	if err != nil {
		return nil, err
	}
	if ready {
		return &Service{}, nil
	}
	if err := readyCtx.Err(); err != nil {
		return nil, err
	}

	processCtx, stop := context.WithCancel(ctx)
	cmd := command(processCtx)
	// Give Ollama time to shut down; exec kills it if it ignores cancellation.
	cmd.Cancel = func() error {
		if err := cmd.Process.Signal(os.Interrupt); err != nil {
			// Windows does not support sending os.Interrupt to a process.
			return cmd.Process.Kill()
		}
		return nil
	}
	cmd.WaitDelay = 3 * time.Second
	if err := cmd.Start(); err != nil {
		stop()
		if errors.Is(err, exec.ErrNotFound) {
			return nil, errors.New("ollama is not running and ollama was not found on PATH; install Ollama and try again")
		}
		return nil, fmt.Errorf("start ollama serve: %w", err)
	}
	service := &Service{stop: stop, done: make(chan struct{})}
	go func() {
		service.err = cmd.Wait()
		close(service.done)
	}()
	if err := service.waitReady(readyCtx, client, baseURL); err != nil {
		service.Close()
		return nil, err
	}
	return service, nil
}

// Reachable checks service identity without loading a model or doing inference.
// A failed connection means the service may need to start. An HTTP response
// that isn't an Ollama version is an error, not permission to replace it.
func reachable(ctx context.Context, client *http.Client, baseURL string) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/api/version", nil)
	if err != nil {
		return false, err
	}
	response, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return false, ctx.Err()
		}
		return false, nil
	}
	defer response.Body.Close()
	var info struct {
		Version string `json:"version"`
	}
	if response.StatusCode != http.StatusOK {
		return false, fmt.Errorf("ollama readiness check at %s returned HTTP %d", baseURL, response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&info); err != nil || info.Version == "" {
		return false, fmt.Errorf("service at %s did not return an Ollama version", baseURL)
	}
	return true, nil
}

func (s *Service) waitReady(ctx context.Context, client *http.Client, baseURL string) error {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait for Ollama readiness: %w", ctx.Err())
		case <-s.done:
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return s.exitError()
		case <-ticker.C:
			ready, err := reachable(ctx, client, baseURL)
			if err != nil {
				return err
			}
			if ready {
				return nil
			}
		}
	}
}

// Wait blocks until shutdown or an owned process exits unexpectedly.
func (s *Service) Wait(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return nil
	case <-s.done:
		if ctx.Err() != nil {
			return nil
		}
		return s.exitError()
	}
}

func (s *Service) exitError() error {
	if s.err != nil {
		return fmt.Errorf("ollama serve exited unexpectedly: %w", s.err)
	}
	return errors.New("ollama serve exited unexpectedly")
}

// Close cancels and reaps an owned process
func (s *Service) Close() error {
	if s.stop != nil {
		s.stop()
		<-s.done
	}
	return nil
}
