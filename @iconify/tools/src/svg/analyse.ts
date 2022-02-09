/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { SVG } from './index';
import { parseSVG } from './parse';
import type { ParseSVGCallbackItem } from './parse';
import type {
	AnalyseSVGStructureResult,
	ExtendedRootTagElement,
	ExtendedTagElement,
	ExtendedTagElementUses,
	LinkToElementWithID,
} from './analyse/types';
import {
	commonColorPresentationalAttributes,
	markerAttributes,
	urlPresentationalAttributes,
} from './data/attributes';
import {
	defsTag,
	maskTags,
	reusableElementsWithPalette,
	useTag,
} from './data/tags';
import { analyseTagError } from './analyse/error';

/**
 * Find all IDs, links, which elements use palette, which items aren't used
 *
 * Before running this function run cleanup functions to change inline style to attributes and fix attributes
 */
export async function analyseSVGStructure(
	svg: SVG
): Promise<AnalyseSVGStructureResult> {
	// Root element
	let root = svg.$svg(':root').get(0) as ExtendedRootTagElement;
	if (root._parsed) {
		// Reload to reset custom properties
		svg.load(svg.toString());
		root = svg.$svg(':root').get(0);
	}
	root._parsed = true;

	// List of all elements
	const elements: AnalyseSVGStructureResult['elements'] = new Map();

	// List of IDs
	const ids: AnalyseSVGStructureResult['ids'] = Object.create(null);

	// Links
	const links: AnalyseSVGStructureResult['links'] = [];

	/**
	 * Found element with id
	 */
	function addID(element: ExtendedTagElement, id: string) {
		if (ids[id] !== void 0) {
			throw new Error(`Duplicate id "${id}"`);
		}
		element._id = id;
		ids[id] = element._index;
	}

	/**
	 * Add _belongsTo
	 */
	function gotElementWithID(
		element: ExtendedTagElement,
		id: string,
		isMask: boolean
	) {
		addID(element, id);
		if (!element._belongsTo) {
			element._belongsTo = [];
		}
		element._belongsTo.push({
			id,
			isMask,
			indexes: new Set([element._index]),
		});
	}

	/**
	 * Mark element as reusable, set properties
	 */
	function gotReusableElement(item: ParseSVGCallbackItem, isMask: boolean) {
		const element = item.element as ExtendedTagElement;
		const attribs = element.attribs;
		const index = element._index;

		const id = attribs['id'];
		if (typeof id !== 'string') {
			throw new Error(
				`Definition element ${analyseTagError(
					element
				)} does not have id`
			);
		}

		element._reusableElement = {
			id,
			isMask,
			index,
		};
		gotElementWithID(element, id, isMask);
	}

	/**
	 * Found element that uses another element
	 */
	function gotElementReference(
		item: ParseSVGCallbackItem,
		id: string,
		usedAsMask: boolean
	) {
		const element = item.element as ExtendedTagElement;
		const usedByIndex = element._index;

		const link: LinkToElementWithID = {
			id,
			usedByIndex,
			usedAsMask,
		};

		// Add to global list
		links.push(link);

		// Add to element and parent elements
		if (!element._linksTo) {
			element._linksTo = [];
		}
		element._linksTo.push(link);
	}

	// Find all reusable elements and all usages
	let index = 0;
	await parseSVG(svg, (item) => {
		const { tagName, parents } = item;
		const element = item.element as ExtendedTagElement;
		const attribs = element.attribs;

		// Set index
		index++;
		element._index = index;
		elements.set(index, element);

		if (!parents.length) {
			// root <svg>
			element._usedAsMask = false;
			element._usedAsPaint = true;
			return;
		}
		element._usedAsMask = false;
		element._usedAsPaint = false;

		// Get parent element
		const parentItem = parents[0];
		const parentElement = parentItem.element as ExtendedTagElement;

		// Check for mask or clip path
		if (maskTags.has(tagName)) {
			// Element can only be used as mask or clip path
			gotReusableElement(item, true);
		} else if (reusableElementsWithPalette.has(tagName)) {
			// Reusable element that uses palette
			gotReusableElement(item, false);
		} else if (defsTag.has(parentItem.tagName)) {
			// Symbol without <symbol> tag
			gotReusableElement(item, false);
		} else if (!defsTag.has(tagName)) {
			// Not reusable element, not <defs>. Copy parent stuff
			element._usedAsMask = parentElement._usedAsMask;
			element._usedAsPaint = parentElement._usedAsPaint;

			// Copy id of reusable element from parent
			const parentReusableElement = parentElement._reusableElement;
			if (parentReusableElement) {
				if (element._reusableElement) {
					// Reusable element inside reusable element: should not happen!
					throw new Error(
						`Reusable element ${analyseTagError(
							element
						)} is inside another reusable element id="${
							parentReusableElement.id
						}"`
					);
				}
				element._reusableElement = parentReusableElement;
			}

			// Copy all parent ids
			const parentBelongsTo = parentElement._belongsTo;
			if (parentBelongsTo) {
				const list = element._belongsTo || (element._belongsTo = []);
				parentBelongsTo.forEach((item) => {
					item.indexes.add(index);
					list.push(item);
				});
			}

			// Check if element has its own id
			if (element._id === void 0) {
				const id = attribs['id'];
				if (typeof id === 'string') {
					gotElementWithID(element, id, false);
				}
			}
		}

		// Check if element uses any ID
		if (useTag.has(tagName)) {
			// <use>
			let id: string | undefined;
			const href = attribs['href'];
			if (typeof href === 'string') {
				if (href.slice(0, 1) !== '#') {
					throw new Error(
						`Invalid link in ${analyseTagError(element)}`
					);
				}
				id = href.slice(1);
			} else {
				throw new Error(
					`Missing "href" attribute in ${analyseTagError(element)}`
				);
			}
			gotElementReference(item, id, false);
			return;
		}

		// Check colors
		Object.keys(attribs).forEach((attr) => {
			// Get id
			let value = attribs[attr];
			if (value.slice(0, 5).toLowerCase() !== 'url(#') {
				return;
			}
			value = value.slice(5);
			if (value.slice(-1) !== ')') {
				return;
			}
			const id = value.slice(0, value.length - 1).trim();

			if (urlPresentationalAttributes.has(attr)) {
				// Used as mask, clip path or filter
				gotElementReference(item, id, attr !== 'filter');
				return;
			}

			if (
				commonColorPresentationalAttributes.has(attr) ||
				markerAttributes.has(attr)
			) {
				// Used as paint
				gotElementReference(item, id, false);
				return;
			}
		});
	});

	if (!Object.keys(ids).length) {
		// No ids found
		return {
			elements,
			ids,
			links,
		};
	}

	// Mark element and its child element as used for paint
	function markUsage(
		key: keyof ExtendedTagElementUses,
		item: ExtendedTagElement
	): ExtendedTagElement[] {
		if (item[key]) {
			return [];
		}
		const id = item._id!;

		// Find all nodes with this id that do not have value set
		const result: ExtendedTagElement[] = [];
		const belongsTo = item._belongsTo!.find((item) => item.id === id)!;
		belongsTo.indexes.forEach((index) => {
			const element = elements.get(index)!;
			if (!element[key]) {
				element[key] = true;
				result.push(element);
			}
		});

		return result;
	}

	// Check links in all elements with paint
	(() => {
		let elementsWithPaint: ExtendedTagElement[] = [];
		elements.forEach((element) => {
			if (element._usedAsPaint) {
				elementsWithPaint.push(element);
			}
		});
		while (elementsWithPaint.length > 0) {
			let added: ExtendedTagElement[] = [];
			elementsWithPaint.forEach((item) => {
				item._linksTo?.forEach((link) => {
					const targetID = link.id;
					const targetElement = elements.get(ids[targetID])!;

					// Check how link is being used
					const usedAsMask = link.usedAsMask;
					if (!usedAsMask && item._usedAsPaint) {
						// Target is used as paint
						added = added.concat(
							markUsage('_usedAsPaint', targetElement)
						);
					}

					if (usedAsMask || item._usedAsMask) {
						// Target is used as mask
						markUsage('_usedAsMask', targetElement);
					}
				});
			});
			elementsWithPaint = added;
		}
	})();

	// Check links in all elements used as mask
	(() => {
		let elementsWithMask: ExtendedTagElement[] = [];
		elements.forEach((element) => {
			if (element._usedAsMask) {
				elementsWithMask.push(element);
			}
		});
		while (elementsWithMask.length > 0) {
			let added: ExtendedTagElement[] = [];
			elementsWithMask.forEach((item) => {
				item._linksTo?.forEach((link) => {
					const targetID = link.id;
					const targetElement = elements.get(ids[targetID])!;
					added = added.concat(
						markUsage('_usedAsMask', targetElement)
					);
				});
			});
			elementsWithMask = added;
		}
	})();

	return {
		elements,
		ids,
		links,
	};
}