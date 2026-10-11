import {it,expect} from 'vitest';import {resolveTheme,oppositeTheme,VIEW_COLORS} from '../src/theme.ts';
it('explicit saved theme overrides system preference',()=>{expect(resolveTheme('dark',false)).toBe('dark');expect(resolveTheme('light',true)).toBe('light');});
it('missing or invalid setting falls back to OS preference',()=>{expect(resolveTheme(null,false)).toBe('light');expect(resolveTheme('invalid',true)).toBe('dark');});
it('toggle is reversible and view palettes contain display-only colors',()=>{expect(oppositeTheme(oppositeTheme('dark'))).toBe('dark');expect(Object.keys(VIEW_COLORS.dark)).toEqual(Object.keys(VIEW_COLORS.light));expect(VIEW_COLORS.dark.checkerA).not.toBe(VIEW_COLORS.light.checkerA);});
