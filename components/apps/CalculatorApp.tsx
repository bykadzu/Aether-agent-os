import React, { useState } from 'react';

export const CalculatorApp: React.FC = () => {
  const [display, setDisplay] = useState('0');
  const [prevValue, setPrevValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);

  const inputDigit = (digit: string) => {
    if (waitingForOperand) {
      setDisplay(digit);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === '0' ? digit : display + digit);
    }
  };

  const performOperation = (nextOperator: string) => {
    const inputValue = parseFloat(display);

    if (prevValue === null) {
      setPrevValue(inputValue);
    } else if (operator) {
      const currentValue = prevValue || 0;
      const newValue = calculate(currentValue, inputValue, operator);
      setPrevValue(newValue);
      setDisplay(String(newValue));
    }

    setWaitingForOperand(true);
    setOperator(nextOperator);
  };

  const calculate = (prev: number, next: number, op: string) => {
    switch (op) {
      case '+': return prev + next;
      case '-': return prev - next;
      case '×': return prev * next;
      case '÷': return prev / next;
      default: return next;
    }
  };

  const handleClear = () => {
    setDisplay('0');
    setPrevValue(null);
    setOperator(null);
    setWaitingForOperand(false);
  };

  const handleSign = () => {
    setDisplay(String(parseFloat(display) * -1));
  };

  const handlePercent = () => {
    setDisplay(String(parseFloat(display) / 100));
  };

  const buttons = [
    { label: display === '0' ? 'AC' : 'C', type: 'func', onClick: handleClear },
    { label: '±', type: 'func', onClick: handleSign },
    { label: '%', type: 'func', onClick: handlePercent },
    { label: '÷', type: 'op', onClick: () => performOperation('÷') },
    { label: '7', type: 'num', onClick: () => inputDigit('7') },
    { label: '8', type: 'num', onClick: () => inputDigit('8') },
    { label: '9', type: 'num', onClick: () => inputDigit('9') },
    { label: '×', type: 'op', onClick: () => performOperation('×') },
    { label: '4', type: 'num', onClick: () => inputDigit('4') },
    { label: '5', type: 'num', onClick: () => inputDigit('5') },
    { label: '6', type: 'num', onClick: () => inputDigit('6') },
    { label: '-', type: 'op', onClick: () => performOperation('-') },
    { label: '1', type: 'num', onClick: () => inputDigit('1') },
    { label: '2', type: 'num', onClick: () => inputDigit('2') },
    { label: '3', type: 'num', onClick: () => inputDigit('3') },
    { label: '+', type: 'op', onClick: () => performOperation('+') },
    { label: '0', type: 'num', width: 'col-span-2', onClick: () => inputDigit('0') },
    { label: '.', type: 'num', onClick: () => inputDigit('.') },
    { label: '=', type: 'op', onClick: () => performOperation('=') },
  ];

  return (
    <div className="h-full bg-black flex flex-col p-4">
      <div className="flex-1 flex items-end justify-end pb-4">
        <div className="text-white text-6xl font-light tabular-nums tracking-tight">
          {display}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {buttons.map((btn, idx) => (
          <button
            key={idx}
            onClick={btn.onClick}
            className={`
              h-16 rounded-full text-2xl font-medium transition-filter active:brightness-125
              ${btn.width || ''}
              ${btn.type === 'func' ? 'bg-[#a5a5a5] text-black' : ''}
              ${btn.type === 'op' ? 'bg-[#ff9f0a] text-white' : ''}
              ${btn.type === 'num' ? 'bg-[#333333] text-white' : ''}
              ${btn.width === 'col-span-2' ? 'text-left pl-7' : 'flex items-center justify-center'}
            `}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
};