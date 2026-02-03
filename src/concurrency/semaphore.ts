export class Semaphore {
  private permits: number;
  private maxPermits: number;
  private waiting: Array<() => void> = [];
  private currentInFlight: number = 0;
  private peakInFlight: number = 0;

  constructor(maxPermits: number) {
    if (maxPermits <= 0) {
      throw new Error('Semaphore maxPermits must be > 0');
    }
    this.permits = maxPermits;
    this.maxPermits = maxPermits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      this.currentInFlight++;
      if (this.currentInFlight > this.peakInFlight) {
        this.peakInFlight = this.currentInFlight;
      }
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    this.currentInFlight--;
    
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      this.currentInFlight++;
      if (this.currentInFlight > this.peakInFlight) {
        this.peakInFlight = this.currentInFlight;
      }
      resolve();
    } else {
      this.permits++;
    }
  }

  tryAcquire(): boolean {
    if (this.permits > 0) {
      this.permits--;
      this.currentInFlight++;
      if (this.currentInFlight > this.peakInFlight) {
        this.peakInFlight = this.currentInFlight;
      }
      return true;
    }
    return false;
  }

  getInFlight(): number {
    return this.currentInFlight;
  }

  getPeak(): number {
    return this.peakInFlight;
  }

  getAvailable(): number {
    return this.permits;
  }

  getWaiting(): number {
    return this.waiting.length;
  }
}