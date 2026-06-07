package task

import (
	"fmt"
	"sync"
	"time"

	"github.com/bestruirui/octopus/internal/utils/log"
	"github.com/robfig/cron/v3"
)

type taskEntry struct {
	name       string
	interval   time.Duration
	cronSpec   string
	schedule   cron.Schedule
	fn         func()
	runOnStart bool
	ticker     *time.Ticker
	stopCh     chan struct{}
	updateCh   chan time.Duration
	cronCh     chan cronUpdate
	lastRun    time.Time
	nextRun    time.Time
	mu         sync.RWMutex
}

var (
	tasks   = make(map[string]*taskEntry)
	tasksMu sync.RWMutex
)

type cronUpdate struct {
	spec     string
	schedule cron.Schedule
}

type TaskStatus struct {
	Name    string    `json:"name"`
	Type    string    `json:"type"`
	Spec    string    `json:"spec"`
	LastRun time.Time `json:"last_run"`
	NextRun time.Time `json:"next_run"`
}

var cronParser = cron.NewParser(
	cron.Minute |
		cron.Hour |
		cron.Dom |
		cron.Month |
		cron.Dow |
		cron.Descriptor,
)

// Register 注册一个定时任务
// runOnStart: 是否在启动时立即执行一次
func Register(name string, interval time.Duration, runOnStart bool, fn func()) {
	if interval <= 0 {
		log.Debugf("task %s not registered: interval is 0", name)
		return
	}

	tasksMu.Lock()
	defer tasksMu.Unlock()

	if _, exists := tasks[name]; exists {
		log.Warnf("task %s already registered, skipping", name)
		return
	}

	tasks[name] = &taskEntry{
		name:       name,
		interval:   interval,
		fn:         fn,
		runOnStart: runOnStart,
		stopCh:     make(chan struct{}),
		updateCh:   make(chan time.Duration),
		cronCh:     make(chan cronUpdate),
	}
	log.Debugf("task %s registered with interval %v, runOnStart: %v", name, interval, runOnStart)
}

func RegisterCron(name string, spec string, runOnStart bool, fn func()) error {
	schedule, err := parseCronSpec(spec)
	if err != nil {
		return err
	}

	tasksMu.Lock()
	defer tasksMu.Unlock()

	if _, exists := tasks[name]; exists {
		log.Warnf("task %s already registered, skipping", name)
		return nil
	}

	now := time.Now()
	tasks[name] = &taskEntry{
		name:       name,
		cronSpec:   spec,
		schedule:   schedule,
		fn:         fn,
		runOnStart: runOnStart,
		stopCh:     make(chan struct{}),
		updateCh:   make(chan time.Duration),
		cronCh:     make(chan cronUpdate),
		nextRun:    schedule.Next(now),
	}
	log.Debugf("task %s registered with cron %q, runOnStart: %v", name, spec, runOnStart)
	return nil
}

// Update 更新任务的执行间隔
// 当 interval 为 0 时，删除任务
func Update(name string, interval time.Duration) {
	tasksMu.Lock()
	entry, exists := tasks[name]
	if !exists {
		tasksMu.Unlock()
		log.Warnf("task %s not found", name)
		return
	}

	if interval <= 0 {
		delete(tasks, name)
		tasksMu.Unlock()
		close(entry.stopCh)
		log.Infof("task %s removed: interval is 0", name)
		return
	}
	tasksMu.Unlock()

	select {
	case entry.updateCh <- interval:
		log.Infof("task %s interval updated to %v", name, interval)
	default:
		log.Warnf("task %s update channel full, skipping", name)
	}
}

func UpdateCron(name string, spec string) error {
	schedule, err := parseCronSpec(spec)
	if err != nil {
		return err
	}

	tasksMu.RLock()
	entry, exists := tasks[name]
	tasksMu.RUnlock()
	if !exists {
		return fmt.Errorf("task %s not found", name)
	}

	select {
	case entry.cronCh <- cronUpdate{spec: spec, schedule: schedule}:
		log.Infof("task %s cron updated to %q", name, spec)
	default:
		log.Warnf("task %s cron update channel full, skipping", name)
	}
	return nil
}

func GetStatus(name string) (TaskStatus, bool) {
	tasksMu.RLock()
	entry, exists := tasks[name]
	tasksMu.RUnlock()
	if !exists {
		return TaskStatus{}, false
	}

	entry.mu.RLock()
	defer entry.mu.RUnlock()
	status := TaskStatus{
		Name:    entry.name,
		LastRun: entry.lastRun,
		NextRun: entry.nextRun,
	}
	if entry.schedule != nil {
		status.Type = "cron"
		status.Spec = entry.cronSpec
	} else {
		status.Type = "interval"
		status.Spec = entry.interval.String()
	}
	return status, true
}

func RunNow(name string) error {
	return RunNowWith(name, nil)
}

func RunNowWith(name string, fn func()) error {
	tasksMu.RLock()
	entry, exists := tasks[name]
	tasksMu.RUnlock()
	if !exists {
		return fmt.Errorf("task %s not found", name)
	}
	markEntryRun(entry)
	if fn == nil {
		fn = entry.fn
	}
	fn()
	return nil
}

func MarkRunNow(name string) error {
	tasksMu.RLock()
	entry, exists := tasks[name]
	tasksMu.RUnlock()
	if !exists {
		return fmt.Errorf("task %s not found", name)
	}
	markEntryRun(entry)
	return nil
}

func parseCronSpec(spec string) (cron.Schedule, error) {
	schedule, err := cronParser.Parse(spec)
	if err != nil {
		return nil, fmt.Errorf("invalid cron expression: %w", err)
	}
	return schedule, nil
}

// RUN 启动所有注册的任务
func RUN() {
	tasksMu.RLock()
	for _, entry := range tasks {
		if entry.schedule != nil {
			go runCronTask(entry)
		} else {
			go runTask(entry)
		}
	}
	tasksMu.RUnlock()

	// 阻塞主协程
	select {}
}

func runCronTask(entry *taskEntry) {
	if entry.runOnStart {
		runEntry(entry)
	}

	for {
		entry.mu.RLock()
		next := entry.nextRun
		entry.mu.RUnlock()

		timer := time.NewTimer(time.Until(next))
		select {
		case <-timer.C:
			runEntry(entry)
			entry.mu.Lock()
			if entry.schedule != nil {
				entry.nextRun = entry.schedule.Next(time.Now())
			}
			entry.mu.Unlock()
		case update := <-entry.cronCh:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			entry.mu.Lock()
			entry.cronSpec = update.spec
			entry.schedule = update.schedule
			entry.nextRun = update.schedule.Next(time.Now())
			entry.mu.Unlock()
		case <-entry.stopCh:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			return
		}
	}
}

func runTask(entry *taskEntry) {
	// 根据配置决定是否在启动时立即执行
	if entry.runOnStart {
		runEntry(entry)
	}

	entry.ticker = time.NewTicker(entry.interval)
	defer entry.ticker.Stop()

	for {
		select {
		case <-entry.ticker.C:
			runEntry(entry)
		case newInterval := <-entry.updateCh:
			entry.ticker.Stop()
			entry.mu.Lock()
			entry.interval = newInterval
			entry.mu.Unlock()
			entry.ticker = time.NewTicker(newInterval)
		case <-entry.stopCh:
			return
		}
	}
}

func runEntry(entry *taskEntry) {
	markEntryRun(entry)
	go entry.fn()
}

func markEntryRun(entry *taskEntry) {
	entry.mu.Lock()
	entry.lastRun = time.Now()
	entry.mu.Unlock()
}
