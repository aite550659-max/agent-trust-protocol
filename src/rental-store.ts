/**
 * Rental Store — Persistent storage for active rentals
 * 
 * Critical: Escrow keys MUST survive process crashes.
 * Without this, escrowed HBAR is permanently lost.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Rental } from './types';

export interface StoredRental extends Rental {
  escrowKey: string; // ED25519 private key (hex)
}

export class RentalStore {
  private filePath: string;
  private rentals: Map<string, StoredRental> = new Map();

  constructor(dataDir: string = path.join(__dirname, '..', 'data')) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.filePath = path.join(dataDir, 'active-rentals.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        for (const [id, rental] of Object.entries(data)) {
          this.rentals.set(id, rental as StoredRental);
        }
      }
    } catch (e) {
      console.error('Warning: Failed to load rental store:', (e as Error).message);
    }
  }

  private save(): void {
    const data: Record<string, StoredRental> = {};
    for (const [id, rental] of this.rentals) {
      data[id] = rental;
    }
    // Atomic write: write to temp file, then rename
    const tmpPath = this.filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }

  put(rental: StoredRental): void {
    this.rentals.set(rental.rentalId, rental);
    this.save();
  }

  get(rentalId: string): StoredRental | undefined {
    return this.rentals.get(rentalId);
  }

  remove(rentalId: string): void {
    this.rentals.delete(rentalId);
    this.save();
  }

  getActive(): StoredRental[] {
    return Array.from(this.rentals.values()).filter(r => r.status === 'active');
  }

  getAll(): StoredRental[] {
    return Array.from(this.rentals.values());
  }

  /** Mark a rental as completed/terminated and archive it */
  complete(rentalId: string, status: 'completed' | 'terminated' = 'completed'): void {
    const rental = this.rentals.get(rentalId);
    if (rental) {
      rental.status = status;
      rental.endedAt = new Date().toISOString();
      // Remove escrow key from active store (rental is settled)
      delete (rental as any).escrowKey;
      this.save();
    }
  }
}
