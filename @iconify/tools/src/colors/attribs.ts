import type { Color } from '@iconify/utils/lib/colors/types';

/**
 * Color attributes
 */
export type CommonColorAttributes = 'color';
export const commonColorAttributes: CommonColorAttributes[] = ['color'];

export type ShapeColorAttributes = 'fill' | 'stroke';
export const shapeColorAttributes: ShapeColorAttributes[] = ['fill', 'stroke'];

export type SpecialColorAttributes = 'stop-color' | 'flood-color';
export const specialColorAttributes: SpecialColorAttributes[] = [
	'stop-color',
	'flood-color',
];

export type ColorAttributes =
	| CommonColorAttributes
	| ShapeColorAttributes
	| SpecialColorAttributes;

/**
 * Default values
 */
export const defaultBlackColor: Color = {
	type: 'rgb',
	r: 0,
	g: 0,
	b: 0,
	alpha: 1,
};

export const defaultColorValues: Record<ColorAttributes, Color> = {
	'color': { type: 'current' },
	'fill': defaultBlackColor,
	'stroke': { type: 'none' },
	'stop-color': defaultBlackColor,
	'flood-color': defaultBlackColor,
};
