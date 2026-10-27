// Package auth pairs the device and keeps it authenticated (BILC.md, "Pairing
// and auth flow"). It never touches the socket or the model.
package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// APIError is the server's `{ code, detail }` error envelope.
type APIError struct {
	Status int
	Code   string
	Detail string
}

func (e *APIError) Error() string {
	if e.Detail != "" {
		return e.Detail
	}
	return fmt.Sprintf("server returned HTTP %d", e.Status)
}

// HasCode reports whether err is an APIError with the given PROTOCOL.md code.
func HasCode(err error, code string) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.Code == code
}

type RegisterRequest struct {
	PairingCode   string `json:"pairing_code"`
	DeviceName    string `json:"device_name"`
	Platform      string `json:"platform"`
	ClientVersion string `json:"client_version"`
}

type Registration struct {
	BilcID       string `json:"bilc_id"`
	RefreshToken string `json:"refresh_token"`
}

type Tokens struct {
	AccessToken  string    `json:"access_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	RefreshToken string    `json:"refresh_token"`
}

// Client calls BILC's REST routes on the server.
type Client struct {
	ServerURL string
	HTTP      *http.Client
}

func (c *Client) Register(ctx context.Context, req RegisterRequest) (Registration, error) {
	var out Registration
	if err := c.post(ctx, "/v1/bilc/register", req, &out); err != nil {
		return Registration{}, err
	}
	if out.BilcID == "" || out.RefreshToken == "" {
		return Registration{}, errors.New("server sent an incomplete registration")
	}
	return out, nil
}

func (c *Client) Refresh(ctx context.Context, bilcID, refreshToken string) (Tokens, error) {
	var out Tokens
	body := map[string]string{"bilc_id": bilcID, "refresh_token": refreshToken}
	if err := c.post(ctx, "/v1/bilc/token", body, &out); err != nil {
		return Tokens{}, err
	}
	if out.AccessToken == "" || out.RefreshToken == "" {
		return Tokens{}, errors.New("server sent incomplete tokens")
	}
	return out, nil
}

// Health checks that the server answers `GET /health`.
func (c *Client) Health(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url("/health"), nil)
	if err != nil {
		return err
	}
	resp, err := c.http().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned HTTP %d", resp.StatusCode)
	}
	return nil
}

func (c *Client) post(ctx context.Context, path string, in, out any) error {
	data, err := json.Marshal(in)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url(path), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http().Do(req)
	if err != nil {
		return fmt.Errorf("reach server: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return fmt.Errorf("read server response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		apiErr := &APIError{Status: resp.StatusCode}
		var envelope struct {
			Code   string `json:"code"`
			Detail any    `json:"detail"`
		}
		if json.Unmarshal(body, &envelope) == nil {
			apiErr.Code = envelope.Code
			// Validation failures carry a list in `detail`; only show plain messages.
			if detail, ok := envelope.Detail.(string); ok {
				apiErr.Detail = detail
			}
		}
		return apiErr
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("server sent an invalid response: %w", err)
	}
	return nil
}

func (c *Client) url(path string) string {
	return strings.TrimRight(c.ServerURL, "/") + path
}

func (c *Client) http() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 15 * time.Second}
}
