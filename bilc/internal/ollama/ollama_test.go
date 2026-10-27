package ollama

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestReuseExistingService(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/version" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		fmt.Fprint(w, `{"version":"test"}`)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service, err := ensure(ctx, server.URL, time.Second, func(context.Context) *exec.Cmd {
		t.Fatal("must not start a process when Ollama is running")
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	if err := service.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	service.Close()
	ready, err := reachable(context.Background(), server.Client(), server.URL)
	if !ready || err != nil {
		t.Fatalf("existing service was affected: ready=%v err=%v", ready, err)
	}
}

func TestStartAndShutdown(t *testing.T) {
	for _, tc := range []struct {
		name         string
		mode         string
		cancelParent bool
	}{
		{"parent cancellation", "wait", true},
		{"explicit close", "wait", false},
		{"kill unresponsive process", "ignore", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			marker := filepath.Join(t.TempDir(), "ready")
			server := fakeService(t, marker)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var cmd *exec.Cmd
			service, err := ensure(ctx, server.URL, 5*time.Second, func(ctx context.Context) *exec.Cmd {
				cmd = helperCommand(t, ctx, tc.mode, marker)
				return cmd
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { service.Close() })
			select {
			case <-service.done:
				t.Fatal("owned process exited before cancellation")
			default:
			}
			if tc.cancelParent {
				cancel()
			}
			service.Close()
			service.Close()
			cancel()
			if err := service.Wait(ctx); err != nil {
				t.Fatal(err)
			}
			if cmd.ProcessState == nil {
				t.Fatal("owned process was not reaped")
			}
		})
	}
}

func TestCancellationDuringStartup(t *testing.T) {
	server := fakeService(t, filepath.Join(t.TempDir(), "never-ready"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var cmd *exec.Cmd
	_, err := ensure(ctx, server.URL, 5*time.Second, func(ctx context.Context) *exec.Cmd {
		cmd = helperCommand(t, ctx, "wait", filepath.Join(t.TempDir(), "started"))
		// Cancel while Ensure is waiting for readiness, after Start returns.
		timer := time.AfterFunc(100*time.Millisecond, cancel)
		t.Cleanup(func() { timer.Stop() })
		return cmd
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v; want context.Canceled", err)
	}
	if cmd == nil || cmd.ProcessState == nil {
		t.Fatal("cancellation did not reap the process")
	}
}

func TestStartupFailuresCleanUp(t *testing.T) {
	for _, tc := range []struct {
		name string
		mode string
		err  string
	}{
		{"early exit", "exit", "exited unexpectedly"},
		{"readiness timeout", "wait", "deadline exceeded"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Never expose the marker to the fake service, so it stays unavailable.
			server := fakeService(t, filepath.Join(t.TempDir(), "never-ready"))
			var cmd *exec.Cmd
			_, err := ensure(context.Background(), server.URL, time.Second, func(ctx context.Context) *exec.Cmd {
				cmd = helperCommand(t, ctx, tc.mode, filepath.Join(t.TempDir(), "started"))
				return cmd
			})
			if err == nil || !strings.Contains(err.Error(), tc.err) {
				t.Fatalf("error = %v; want %q", err, tc.err)
			}
			if cmd == nil || cmd.ProcessState == nil {
				t.Fatal("failed startup did not reap its process")
			}
		})
	}
}

func TestUnexpectedExitAfterReady(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "ready")
	server := fakeService(t, marker)
	var cmd *exec.Cmd
	service, err := ensure(context.Background(), server.URL, 5*time.Second, func(ctx context.Context) *exec.Cmd {
		cmd = helperCommand(t, ctx, "wait", marker)
		return cmd
	})
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := service.Wait(ctx); err == nil || !strings.Contains(err.Error(), "exited unexpectedly") {
		t.Fatalf("error = %v; want unexpected exit", err)
	}
}

func TestMissingExecutable(t *testing.T) {
	server := fakeService(t, filepath.Join(t.TempDir(), "never-ready"))
	_, err := ensure(context.Background(), server.URL, time.Second, func(ctx context.Context) *exec.Cmd {
		cmd := exec.CommandContext(ctx, "ollama", "serve")
		cmd.Err = exec.ErrNotFound // Independent of the machine's installed Ollama.
		return cmd
	})
	if err == nil || !strings.Contains(err.Error(), "install Ollama") {
		t.Fatalf("error = %v; want installation guidance", err)
	}
}

func TestCanceledBeforeStartup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := ensure(ctx, "http://127.0.0.1:1", time.Second, func(context.Context) *exec.Cmd {
		t.Fatal("must not start a process with a canceled context")
		return nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v; want context.Canceled", err)
	}
}

func TestRejectOtherHTTPService(t *testing.T) {
	for _, body := range []string{`{}`, `not json`, `{"version":""}`} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprint(w, body)
			}))
			defer server.Close()
			_, err := ensure(context.Background(), server.URL, time.Second, func(context.Context) *exec.Cmd {
				t.Fatal("must not start a process over an unrecognized HTTP service")
				return nil
			})
			if err == nil {
				t.Fatal("expected invalid service error")
			}
		})
	}
}

// The subprocess stands in for ollama serve; it never loads a model.
func TestOllamaProcess(t *testing.T) {
	mode := os.Getenv("BILC_TEST_OLLAMA_MODE")
	if mode == "" {
		return
	}
	if mode == "exit" {
		os.Exit(7)
	}
	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt)
	if mode == "ignore" {
		signal.Ignore(os.Interrupt)
	}
	if err := os.WriteFile(os.Getenv("BILC_TEST_OLLAMA_MARKER"), nil, 0600); err != nil {
		os.Exit(2)
	}
	<-interrupt
	os.Exit(0)
}

func helperCommand(t *testing.T, ctx context.Context, mode, marker string) *exec.Cmd {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(ctx, executable, "-test.run=^TestOllamaProcess$")
	cmd.Env = append(cmd.Environ(), "BILC_TEST_OLLAMA_MODE="+mode, "BILC_TEST_OLLAMA_MARKER="+marker, "GORACE=atexit_sleep_ms=0")
	return cmd
}

func fakeService(t *testing.T, marker string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/version" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if _, err := os.Stat(marker); err == nil {
			fmt.Fprint(w, `{"version":"test"}`)
			return
		}
		// Simulate a service that cannot yet accept requests.
		conn, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			conn.Close()
		}
	}))
	t.Cleanup(server.Close)
	return server
}
