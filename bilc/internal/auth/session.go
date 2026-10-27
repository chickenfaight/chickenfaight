package auth

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// ErrNotPaired means the device must be paired (again) with `bilc pair`.
var ErrNotPaired = errors.New("this device isn't paired; get a code from the BILC page and run `bilc pair <code>`")

// refreshMargin renews the access token this long before it expires.
const refreshMargin = time.Minute

// Session hands out access tokens, rotating the refresh token as it goes.
type Session struct {
	Client *Client
	Store  Store
	BilcID string
	Now    func() time.Time // nil means time.Now

	mu        sync.Mutex
	access    string
	expiresAt time.Time
}

// AccessToken returns a current access token. force skips the cached one,
// for when the server rejected it (close code 4401).
//
// Each refresh token works once: the new one is stored before the access
// token is returned. If the server no longer accepts the device, its
// credentials are deleted and the error wraps ErrNotPaired.
func (s *Session) AccessToken(ctx context.Context, force bool) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !force && s.access != "" && s.now().Before(s.expiresAt.Add(-refreshMargin)) {
		return s.access, nil
	}
	refreshToken, err := s.Store.Load(s.BilcID)
	if errors.Is(err, ErrNoCredentials) {
		return "", ErrNotPaired
	}
	if err != nil {
		return "", err
	}
	tokens, err := s.Client.Refresh(ctx, s.BilcID, refreshToken)
	if HasCode(err, "TOKEN_INVALID") {
		if deleteErr := s.Store.Delete(s.BilcID); deleteErr != nil {
			return "", fmt.Errorf("%w (also failed to delete old credentials: %v)", ErrNotPaired, deleteErr)
		}
		return "", fmt.Errorf("the server no longer accepts this device (revoked from the web app, or its token was used twice): %w", ErrNotPaired)
	}
	if err != nil {
		return "", err
	}
	if err := s.Store.Save(s.BilcID, tokens.RefreshToken); err != nil {
		// The old token is spent; using it again would revoke the device.
		return "", fmt.Errorf("save new credentials (you may need to pair again): %w", err)
	}
	s.access, s.expiresAt = tokens.AccessToken, tokens.ExpiresAt
	return s.access, nil
}

func (s *Session) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}
