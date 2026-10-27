package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/chickenfaight/chickenfaight/bilc/internal/auth"
	"github.com/chickenfaight/chickenfaight/bilc/internal/config"
	"github.com/chickenfaight/chickenfaight/bilc/internal/conn"
	"github.com/chickenfaight/chickenfaight/bilc/internal/match"
	"github.com/chickenfaight/chickenfaight/bilc/internal/model"
	"github.com/chickenfaight/chickenfaight/bilc/internal/ollama"
	"github.com/chickenfaight/chickenfaight/bilc/internal/protocol"
)

func (c *cli) runCommand(args []string) error {
	flags := flag.NewFlagSet("run", flag.ContinueOnError)
	verbose := flags.Bool("verbose", false, "Show detailed progress")
	positional, done, err := c.parseFlags(flags, args, `Usage: bilc run [--verbose]

Ensure local Ollama is running, then connect to the server and play your
model's turns in BYOM matches until Ctrl-C.

Flags:
  --verbose  Show detailed progress
  -h, --help Show this help

Example:
  bilc run --verbose`)
	if done || err != nil {
		return err
	}
	if len(positional) != 0 {
		return errors.New("run does not accept positional arguments; use bilc run --help")
	}

	cfg, path, err := c.loadConfig()
	if err != nil {
		return err
	}
	if cfg.BilcID == "" {
		return auth.ErrNotPaired
	}
	if cfg.Model.Name == "" {
		return errors.New("no model chosen; run bilc model set --model <name>")
	}
	if modelURL, err := config.ParseHTTPURL(cfg.Model.BaseURL); err != nil {
		return fmt.Errorf("model URL in config: %w", err)
	} else if !config.IsLoopback(modelURL) {
		fmt.Fprintf(c.stderr, "warning: %s isn't on this machine; debate prompts will leave it\n", modelURL)
	}
	serverURL, err := config.ParseHTTPURL(cfg.ServerURL)
	if err != nil {
		return fmt.Errorf("server URL in config: %w", err)
	}
	c.warnIfInsecure(serverURL)
	store, err := c.credentials()
	if err != nil {
		return err
	}

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
	if *verbose {
		fmt.Fprintf(c.stderr, "Ollama ready after %s.\n", time.Since(started).Round(time.Millisecond))
	}
	local := &model.OpenAI{BaseURL: cfg.Model.BaseURL, Name: cfg.Model.Name}
	infoCtx, cancelInfo := context.WithTimeout(ctx, 10*time.Second)
	info, err := local.Info(infoCtx)
	cancelInfo()
	if err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return fmt.Errorf("check model %s: %w", cfg.Model.Name, err)
	}
	if size, ok := info.Metadata["parameter_size"].(string); ok {
		fmt.Fprintf(c.stderr, "Model %s (%s parameters) ready.\n", info.Name, size)
	} else {
		fmt.Fprintf(c.stderr, "Model %s ready (size unknown, so it plays in the largest class).\n", info.Name)
	}
	fmt.Fprintln(c.stderr, "Connecting to", cfg.ServerURL, "(Ctrl-C to stop).")

	session := &auth.Session{Client: &auth.Client{ServerURL: cfg.ServerURL}, Store: store, BilcID: cfg.BilcID}
	handler := &match.Handler{Model: local, Log: c.stderr}
	defer handler.Wait()
	manager := &conn.Manager{
		URL:   socketURL(serverURL),
		Token: session.AccessToken,
		Hello: protocol.Hello{
			ProtocolVersion: protocol.Version,
			ClientVersion:   version,
			Platform:        platform(),
			Model:           protocol.HelloModel{Name: info.Name, ContextLength: info.ContextLength, Metadata: info.Metadata},
		},
		Log:     c.stderr,
		Handler: handler,
	}

	// Serve until Ctrl-C, a fatal connection error, or the owned Ollama exiting.
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make(chan error, 2)
	go func() { results <- manager.Run(ctx) }()
	go func() { results <- service.Wait(ctx) }()
	err = <-results
	cancel()
	if other := <-results; err == nil {
		err = other
	}
	if errors.Is(err, auth.ErrNotPaired) {
		// The credentials are already gone; forget the device ID too.
		cfg.BilcID = ""
		if saveErr := config.Save(path, cfg); saveErr != nil {
			return errors.Join(err, saveErr)
		}
	}
	return err
}

// socketURL is the server's /v1/bilc/ws, over wss:// for https:// servers.
func socketURL(server *url.URL) string {
	u := *server
	u.Scheme = map[string]string{"http": "ws", "https": "wss"}[server.Scheme]
	u.Path = strings.TrimRight(u.Path, "/") + "/v1/bilc/ws"
	return u.String()
}
