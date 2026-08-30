package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

func main() {
	baseURL := flag.String("base-url", "http://localhost:8080", "Bling API base URL")
	origin := flag.String("origin", "http://localhost:5173", "allowed browser origin for WebSocket handshakes")
	showID := flag.String("show", "", "live show UUID")
	callers := flag.Int("callers", 1000, "number of callers")
	concurrency := flag.Int("concurrency", 100, "simultaneous workers")
	websockets := flag.Bool("websockets", false, "keep one queue WebSocket open per joined caller")
	hold := flag.Duration("hold", 30*time.Second, "how long to hold WebSocket clients")
	flag.Parse()
	if *showID == "" || *callers < 1 || *concurrency < 1 {
		fmt.Fprintln(os.Stderr, "-show is required and counts must be positive")
		os.Exit(2)
	}

	jobs := make(chan int)
	latencies := make(chan time.Duration, *callers)
	cookies := make(chan string, *callers)
	var failures atomic.Int64
	client := &http.Client{Timeout: 15 * time.Second}
	started := time.Now()
	var workers sync.WaitGroup
	for worker := 0; worker < *concurrency; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for caller := range jobs {
				body := []byte(fmt.Sprintf(`{"displayName":"Load Caller %d","topic":"Queue load verification"}`, caller))
				request, err := http.NewRequestWithContext(context.Background(), http.MethodPost, *baseURL+"/api/v1/shows/"+*showID+"/queue", bytes.NewReader(body))
				if err != nil {
					failures.Add(1)
					continue
				}
				request.Header.Set("Content-Type", "application/json")
				request.Header.Set("Idempotency-Key", fmt.Sprintf("load-%d-%d", started.UnixNano(), caller))
				requestStarted := time.Now()
				response, err := client.Do(request)
				latencies <- time.Since(requestStarted)
				if err != nil {
					failures.Add(1)
					continue
				}
				_, _ = io.Copy(io.Discard, response.Body)
				_ = response.Body.Close()
				if response.StatusCode != http.StatusCreated {
					failures.Add(1)
					continue
				}
				if *websockets {
					found := false
					for _, cookie := range response.Cookies() {
						if cookie.Name == "bling_viewer" {
							cookies <- cookie.Name + "=" + cookie.Value
							found = true
						}
					}
					if !found {
						failures.Add(1)
					}
				}
			}
		}()
	}
	for caller := 0; caller < *callers; caller++ {
		jobs <- caller
	}
	close(jobs)
	workers.Wait()
	close(latencies)
	close(cookies)

	connected := 0
	if *websockets && failures.Load() == 0 {
		connected = holdWebsockets(*baseURL, *origin, *showID, cookies, *concurrency, *hold, &failures)
	}

	values := make([]time.Duration, 0, *callers)
	for latency := range latencies {
		values = append(values, latency)
	}
	sort.Slice(values, func(left, right int) bool { return values[left] < values[right] })
	elapsed := time.Since(started)
	fmt.Printf("callers=%d websocket_clients=%d failures=%d elapsed=%s throughput=%.1f/s", *callers, connected, failures.Load(), elapsed.Round(time.Millisecond), float64(*callers)/elapsed.Seconds())
	if len(values) > 0 {
		fmt.Printf(" p50=%s p95=%s\n", percentile(values, 50).Round(time.Millisecond), percentile(values, 95).Round(time.Millisecond))
	} else {
		fmt.Println()
	}
	if failures.Load() > 0 {
		os.Exit(1)
	}
}

func holdWebsockets(baseURL, origin, showID string, cookies <-chan string, concurrency int, hold time.Duration, failures *atomic.Int64) int {
	wsBase := strings.Replace(baseURL, "https://", "wss://", 1)
	wsBase = strings.Replace(wsBase, "http://", "ws://", 1)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var connectionsMu sync.Mutex
	connections := make([]*websocket.Conn, 0)
	semaphore := make(chan struct{}, concurrency)
	var wait sync.WaitGroup
	for cookie := range cookies {
		cookie := cookie
		wait.Add(1)
		go func() {
			defer wait.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()
			header := http.Header{}
			header.Set("Cookie", cookie)
			header.Set("Origin", origin)
			connection, _, err := websocket.Dial(ctx, wsBase+"/api/v1/shows/"+showID+"/queue/events", &websocket.DialOptions{HTTPHeader: header})
			if err != nil {
				failures.Add(1)
				return
			}
			connectionsMu.Lock()
			connections = append(connections, connection)
			connectionsMu.Unlock()
		}()
	}
	wait.Wait()
	readCtx, stopReads := context.WithCancel(context.Background())
	for _, connection := range connections {
		connection := connection
		go func() {
			for {
				if _, _, err := connection.Read(readCtx); err != nil {
					return
				}
			}
		}()
	}
	timer := time.NewTimer(hold)
	<-timer.C
	stopReads()
	for _, connection := range connections {
		_ = connection.Close(websocket.StatusNormalClosure, "load test complete")
	}
	return len(connections)
}

func percentile(values []time.Duration, percentile int) time.Duration {
	index := (len(values)*percentile + 99) / 100
	if index < 1 {
		index = 1
	}
	return values[index-1]
}
