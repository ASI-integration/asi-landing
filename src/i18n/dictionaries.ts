import en from './en.json';
import ru from './ru.json';

export type Dict = Record<string, unknown>;

export const dictionaries: Record<'en' | 'ru', Dict> = {
  en: en as Dict,
  ru: ru as Dict,
};
