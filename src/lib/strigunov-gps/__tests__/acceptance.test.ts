import { describe, it, expect } from 'vitest';
import { acceptedPrefix, physicallyAccepted } from '../acceptance';

const stage = (id: string, status: string, proofCount: number) => ({id, status, proofCount});

describe('Strigunov GPS physical acceptance gate', () => {
  it('rejects CI-only or unsigned stage progress', () => {
    expect(physicallyAccepted(stage('S4-G1', 'ACCEPTED', 1), [])).toBe(false);
  });
  it('rejects verified server signal without canonical acceptance', () => {
    expect(physicallyAccepted(stage('S4-G1', 'IN_PROGRESS', 0), ['S4-G1'])).toBe(false);
  });
  it('rejects accepted label without canonical proof', () => {
    expect(physicallyAccepted(stage('S4-G1', 'ACCEPTED', 0), ['S4-G1'])).toBe(false);
  });
  it('only counts independently verified accepted stage', () => {
    expect(physicallyAccepted(stage('S4-G1', 'ACCEPTED', 1), ['S4-G1'])).toBe(true);
  });
  it('does not jump over an incomplete earlier gate', () => {
    expect(acceptedPrefix([
      stage('S4-G1', 'IN_PROGRESS', 0),
      stage('S4-G2', 'ACCEPTED', 1),
    ], ['S4-G2'])).toBe(0);
  });
  it('counts only contiguous, independently proven acceptances', () => {
    expect(acceptedPrefix([
      stage('S4-G1', 'ACCEPTED', 1),
      stage('S4-G2', 'ACCEPTED', 1),
      stage('S4-G3', 'NOT_STARTED', 0),
    ], ['S4-G1', 'S4-G2'])).toBe(2);
  });
});
