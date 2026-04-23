import { useCallback, useEffect, useRef, useState } from 'react';
import { getJob, getBatchJobs } from '@/lib/api';

const POLL_INTERVAL_MS = 1500;
const SESSION_JOB_KEY = 'trustreply_current_job_id';
const SESSION_BATCH_KEY = 'trustreply_current_batch_id';

function isFinishedStatus(status) {
    return status === 'done' || status === 'error';
}

function jobNeedsReview(job) {
    return (
        job.status === 'done' &&
        ((job.flagged_questions_count || 0) > 0 || job.fallback_recommended || job.total_questions === 0)
    );
}

/**
 * Polls a single job or a batch until all items reach a terminal state.
 *
 * The hook owns `currentJob` / `currentBatch` state plus the timer and
 * in-flight guard that prevent overlapping fetches. Consumers supply
 * callbacks invoked on terminal transitions (done, error, batch complete).
 */
export function useJobPolling({ onJobDone, onJobError, onBatchComplete } = {}) {
    const [currentJob, setCurrentJob] = useState(null);
    const [currentBatch, setCurrentBatch] = useState(null);

    const pollRef = useRef(null);
    const pollingInFlight = useRef(false);
    // Callback refs keep the polling loop stable even when callbacks change identity.
    const onJobDoneRef = useRef(onJobDone);
    const onJobErrorRef = useRef(onJobError);
    const onBatchCompleteRef = useRef(onBatchComplete);

    useEffect(() => { onJobDoneRef.current = onJobDone; }, [onJobDone]);
    useEffect(() => { onJobErrorRef.current = onJobError; }, [onJobError]);
    useEffect(() => { onBatchCompleteRef.current = onBatchComplete; }, [onBatchComplete]);

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const pollJob = useCallback(async (jobId) => {
        if (pollingInFlight.current) return;
        pollingInFlight.current = true;
        try {
            const job = await getJob(jobId);
            setCurrentJob(job);

            if (job.status === 'done') {
                stopPolling();
                onJobDoneRef.current?.(job, { needsReview: jobNeedsReview(job) });
            } else if (job.status === 'error') {
                stopPolling();
                onJobErrorRef.current?.(job);
            }
        } catch {
            stopPolling();
        } finally {
            pollingInFlight.current = false;
        }
    }, [stopPolling]);

    const pollBatch = useCallback(async (batchId) => {
        if (pollingInFlight.current) return;
        pollingInFlight.current = true;
        try {
            const batch = await getBatchJobs(batchId);
            setCurrentBatch(batch);

            if (batch.items.every((job) => isFinishedStatus(job.status))) {
                stopPolling();
                const doneCount = batch.items.filter((job) => job.status === 'done').length;
                const errorCount = batch.items.filter((job) => job.status === 'error').length;
                const reviewCount = batch.items.filter((job) => jobNeedsReview(job)).length;
                onBatchCompleteRef.current?.(batch, { doneCount, errorCount, reviewCount });
            }
        } catch {
            stopPolling();
        } finally {
            pollingInFlight.current = false;
        }
    }, [stopPolling]);

    const startJobPolling = useCallback((job) => {
        stopPolling();
        setCurrentJob(job);
        setCurrentBatch(null);
        sessionStorage.setItem(SESSION_JOB_KEY, String(job.id));
        sessionStorage.removeItem(SESSION_BATCH_KEY);
        if (!isFinishedStatus(job.status)) {
            pollRef.current = setInterval(() => pollJob(job.id), POLL_INTERVAL_MS);
        }
    }, [pollJob, stopPolling]);

    const startBatchPolling = useCallback((batch) => {
        stopPolling();
        setCurrentBatch(batch);
        setCurrentJob(null);
        sessionStorage.setItem(SESSION_BATCH_KEY, batch.batch_id);
        sessionStorage.removeItem(SESSION_JOB_KEY);
        const allDone = batch.items?.every((j) => isFinishedStatus(j.status));
        if (!allDone) {
            pollRef.current = setInterval(() => pollBatch(batch.batch_id), POLL_INTERVAL_MS);
        }
    }, [pollBatch, stopPolling]);

    const clearCurrent = useCallback(() => {
        stopPolling();
        setCurrentJob(null);
        setCurrentBatch(null);
        sessionStorage.removeItem(SESSION_JOB_KEY);
        sessionStorage.removeItem(SESSION_BATCH_KEY);
    }, [stopPolling]);

    // Resume polling from sessionStorage on mount so navigating back to the
    // page keeps tracking an in-flight job without user action.
    useEffect(() => {
        const savedBatchId = sessionStorage.getItem(SESSION_BATCH_KEY);
        const savedJobId = sessionStorage.getItem(SESSION_JOB_KEY);

        if (savedBatchId) {
            getBatchJobs(savedBatchId)
                .then((batch) => startBatchPolling(batch))
                .catch(() => sessionStorage.removeItem(SESSION_BATCH_KEY));
        } else if (savedJobId) {
            getJob(Number(savedJobId))
                .then((job) => startJobPolling(job))
                .catch(() => sessionStorage.removeItem(SESSION_JOB_KEY));
        }

        return stopPolling;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return {
        currentJob,
        currentBatch,
        setCurrentJob,
        setCurrentBatch,
        startJobPolling,
        startBatchPolling,
        stopPolling,
        clearCurrent,
    };
}

// Exported so consumers can reuse the same status predicates.
export { isFinishedStatus, jobNeedsReview };
