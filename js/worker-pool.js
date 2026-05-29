class WorkerPoolManager {
    constructor(workerScript, maxWorkers = null) {
        this.workerScript = workerScript;
        this.maxWorkers = maxWorkers || Math.min(navigator.hardwareConcurrency || 4, 16);
        this.workers = [];
        this.availableWorkers = [];
        this.taskQueue = [];
        this.isInitialized = false;
        console.log(`WorkerPool: Инициализация с ${this.maxWorkers} воркерами`);
    }
    async initialize() {
        if (this.isInitialized) return;
        const startTime = performance.now();
        const workerPromises = Array.from({ length: this.maxWorkers }, (_, i) => this.createWorker(i));
        await Promise.all(workerPromises);
        this.isInitialized = true;
        const duration = performance.now() - startTime;
        console.log(`WorkerPool: ${this.maxWorkers} воркеров готовы за ${duration.toFixed(1)}ms`);
    }
    createWorker(id) {
        return new Promise((resolve, reject) => {
            try {
                const worker = new Worker(this.workerScript);
                worker._id = id;
                worker.onmessage = (e) => this.handleWorkerMessage(worker, e);
                worker.onerror = (e) => this.handleWorkerError(worker, e);
                this.workers.push(worker);
                this.availableWorkers.push(worker);
                resolve(worker);
            } catch (error) {
                reject(new Error(`Ошибка создания воркера ${id}: ${error.message}`));
            }
        });
    }
    handleWorkerMessage(worker, event) {
        if (worker._currentTask) {
            const data = event.data;
            if (data && data.error) {
                worker._currentTask.reject(new Error(data.error));
            } else {
                worker._currentTask.resolve(data);
            }
            worker._currentTask = null;
        }
        this.availableWorkers.push(worker);
        this.processQueue();
    }
    handleWorkerError(worker, error) {
        console.error(`Воркер ${worker._id} ошибка:`, error);
        if (worker._currentTask) {
            worker._currentTask.reject(error.error || new Error(error.message || 'Worker error'));
            worker._currentTask = null;
        }
        // Возвращаем воркер в пул, чтобы очередь не зависла
        this.availableWorkers.push(worker);
        this.processQueue();
    }
    async executeTask(data, transferList = []) {
        if (!this.isInitialized) await this.initialize();
        return new Promise((resolve, reject) => {
            const task = { data, transferList, resolve, reject };
            if (this.availableWorkers.length > 0) {
                this.assignTask(task);
            } else {
                this.taskQueue.push(task);
            }
        });
    }
    assignTask(task) {
        const worker = this.availableWorkers.pop();
        worker._currentTask = task;
        worker.postMessage(task.data, task.transferList);
    }
    processQueue() {
        while (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
            this.assignTask(this.taskQueue.shift());
        }
    }
}
window.WorkerPoolManager = WorkerPoolManager;