import { describe, it, expect } from 'vitest';
import { getErrorMessage, getErrorCode, isNotFoundError } from '../errors.js';

describe('getErrorMessage', () => {
  it('extracts message from Error instance', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns string values directly', () => {
    expect(getErrorMessage('something broke')).toBe('something broke');
  });

  it('extracts message from plain objects', () => {
    expect(getErrorMessage({ message: 'obj error' })).toBe('obj error');
  });

  it('stringifies non-standard values', () => {
    expect(getErrorMessage(42)).toBe('42');
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
  });

  it('handles objects without message property', () => {
    expect(getErrorMessage({ code: 'FAIL' })).toBe('[object Object]');
  });
});

describe('getErrorCode', () => {
  it('extracts code from Error-like objects', () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
    expect(getErrorCode(err)).toBe('ENOENT');
  });

  it('extracts code from plain objects', () => {
    expect(getErrorCode({ code: 'EACCES', message: 'denied' })).toBe('EACCES');
  });

  it('returns undefined when no code property', () => {
    expect(getErrorCode(new Error('plain'))).toBeUndefined();
  });

  it('returns undefined for non-string code', () => {
    expect(getErrorCode({ code: 123 })).toBeUndefined();
  });

  it('returns undefined for primitives', () => {
    expect(getErrorCode('string')).toBeUndefined();
    expect(getErrorCode(null)).toBeUndefined();
  });
});

describe('isNotFoundError', () => {
  it('detects ENOENT code', () => {
    const err = Object.assign(new Error('file missing'), { code: 'ENOENT' });
    expect(isNotFoundError(err)).toBe(true);
  });

  it('detects ENOENT in message', () => {
    expect(isNotFoundError(new Error('ENOENT: no such file'))).toBe(true);
  });

  it('detects ENOENT in plain object message', () => {
    expect(isNotFoundError({ message: 'path ENOENT error' })).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isNotFoundError(new Error('permission denied'))).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isNotFoundError(null)).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
  });
});
