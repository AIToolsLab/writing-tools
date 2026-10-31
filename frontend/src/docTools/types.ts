/**
 * Shared vocabulary for the document tools (`view` and the own-words edit
 * tools) used by Chat and the My Words prototypes.
 */

/** A single document operation. `move` relocates the writer's own words. */
export type EditOp =
	| {
			kind: 'str_replace';
			oldStr: string;
			newStr: string;
			/** Optional 1-based paragraph (from `view`) to scope the search to. */
			paragraph?: number;
	  }
	| {
			kind: 'insert';
			text: string;
			after?: string;
			paragraph?: number;
			position?: 'before' | 'after';
	  }
	| {
			kind: 'move';
			/** Existing text to relocate (lifted verbatim — adds no words). */
			phrase: string;
			paragraph: number;
			position?: 'before' | 'after';
	  };
