package social

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxStoredAvatarBytes = 768 * 1024

type SupabaseAvatarStore struct {
	baseURL    string
	serviceKey string
	bucket     string
	client     *http.Client
}

func NewSupabaseAvatarStore(baseURL, serviceKey, bucket string, timeout time.Duration) (*SupabaseAvatarStore, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	parsed, err := url.ParseRequestURI(baseURL)
	if err != nil || parsed.Host == "" || parsed.Scheme != "https" {
		return nil, errors.New("supabase storage URL must be an absolute HTTPS URL")
	}
	serviceKey = strings.TrimSpace(serviceKey)
	if serviceKey == "" || strings.Count(serviceKey, ".") != 2 {
		return nil, errors.New("supabase storage service key must be a JWT")
	}
	bucket = strings.TrimSpace(bucket)
	if bucket == "" || strings.ContainsAny(bucket, "/\\") {
		return nil, errors.New("supabase storage bucket is invalid")
	}
	if timeout <= 0 {
		return nil, errors.New("supabase storage timeout must be positive")
	}
	return &SupabaseAvatarStore{
		baseURL: baseURL, serviceKey: serviceKey, bucket: bucket,
		client: &http.Client{Timeout: timeout},
	}, nil
}

func (s *SupabaseAvatarStore) Put(ctx context.Context, userID, contentType string, data []byte) error {
	if len(data) == 0 || len(data) > maxStoredAvatarBytes || !validAvatarContentType(contentType) {
		return ErrInvalid
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		s.objectURL("object", userID),
		bytes.NewReader(data),
	)
	if err != nil {
		return fmt.Errorf("create avatar storage request: %w", err)
	}
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("x-upsert", "true")
	return s.do(request, nil)
}

func (s *SupabaseAvatarStore) Get(ctx context.Context, userID string) (Avatar, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, s.objectURL("object/authenticated", userID), nil)
	if err != nil {
		return Avatar{}, fmt.Errorf("create avatar storage request: %w", err)
	}
	var avatar Avatar
	if err := s.do(request, &avatar); err != nil {
		return Avatar{}, err
	}
	return avatar, nil
}

func (s *SupabaseAvatarStore) objectURL(route, userID string) string {
	return s.baseURL + "/storage/v1/" + route + "/" + url.PathEscape(s.bucket) + "/" + url.PathEscape(userID) + "/avatar"
}

func (s *SupabaseAvatarStore) do(request *http.Request, destination *Avatar) error {
	request.Header.Set("apikey", s.serviceKey)
	request.Header.Set("Authorization", "Bearer "+s.serviceKey)
	request.Header.Set("Accept", "application/json, image/*")
	response, err := s.client.Do(request)
	if err != nil {
		return fmt.Errorf("avatar storage request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return ErrNotFound
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return errors.New("avatar storage request failed")
	}
	if destination == nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return nil
	}
	contentType := strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0])
	if !validAvatarContentType(contentType) {
		return errors.New("avatar storage returned an invalid content type")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxStoredAvatarBytes+1))
	if err != nil {
		return fmt.Errorf("read avatar storage response: %w", err)
	}
	if len(data) == 0 || len(data) > maxStoredAvatarBytes {
		return errors.New("avatar storage returned an invalid object")
	}
	destination.ContentType = contentType
	destination.Data = data
	return nil
}

func validAvatarContentType(contentType string) bool {
	return contentType == "image/jpeg" || contentType == "image/png" || contentType == "image/webp"
}
