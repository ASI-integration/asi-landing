'use client';

import { HTMLInputAutoCompleteAttribute } from 'react';

type CrmSuggestInputProps = {
  id: string;
  listId: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  autoComplete?: HTMLInputAutoCompleteAttribute;
  className?: string;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
};

export function CrmSuggestInput({
  id,
  listId,
  value,
  onChange,
  suggestions,
  autoComplete = 'off',
  className,
  type = 'text',
  placeholder,
  disabled,
}: CrmSuggestInputProps) {
  return (
    <>
      <input
        id={id}
        list={listId}
        type={type}
        autoComplete={autoComplete}
        className={className}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {suggestions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  );
}
