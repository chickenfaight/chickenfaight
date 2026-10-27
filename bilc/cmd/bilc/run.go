package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/chickenfaight/chickenfaight/bilc/internal/ollama"
)

func runOllama(verbose bool) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	started := time.Now()
	service, err := ollama.Ensure(ctx)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil
		}
		return err
	}
	defer service.Close()

	if verbose {
		fmt.Fprintf(os.Stderr, "Ollama ready after %s.\n", time.Since(started).Round(time.Millisecond))
	}
	fmt.Fprintln(os.Stderr, "Ollama ready. Press Ctrl-C to stop BILC.")
	// Match serving will replace this wait when server integration is added.
	return service.Wait(ctx)
}
