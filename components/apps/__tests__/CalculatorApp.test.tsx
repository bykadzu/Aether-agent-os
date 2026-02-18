// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock lucide-react icons (CalculatorApp doesn't use any, but harmless)
vi.mock('lucide-react', () => {
  const createIcon = (name: string) => (props: any) => (
    <span data-testid={`icon-${name}`} {...props} />
  );
  return {
    __esModule: true,
    default: createIcon('default'),
  };
});

import { CalculatorApp } from '../CalculatorApp';

describe('CalculatorApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<CalculatorApp />);
    expect(container).toBeTruthy();
  });

  it('shows display with initial value "0"', () => {
    const { container } = render(<CalculatorApp />);
    const display = container.querySelector('.text-6xl');
    expect(display).toBeTruthy();
    expect(display!.textContent).toBe('0');
  });

  it('renders AC button', () => {
    render(<CalculatorApp />);
    expect(screen.getByText('AC')).toBeTruthy();
  });

  it('basic calculation: 5 + 3 = 8', () => {
    const { container } = render(<CalculatorApp />);
    fireEvent.click(screen.getByText('5'));
    fireEvent.click(screen.getByText('+'));
    fireEvent.click(screen.getByText('3'));
    fireEvent.click(screen.getByText('='));
    const display = container.querySelector('.text-6xl');
    expect(display!.textContent).toBe('8');
  });

  it('clear: click 5 then AC resets display to 0', () => {
    const { container } = render(<CalculatorApp />);
    fireEvent.click(screen.getByText('5'));
    // After typing 5, the button label changes to "C"
    fireEvent.click(screen.getByText('C'));
    const display = container.querySelector('.text-6xl');
    expect(display!.textContent).toBe('0');
  });
});
