type Segments = ReadonlyArray<string | number>;

/** The react-hook-form name of the field at a path: `["files", 2, "input"]` → `"files.2.input"`. */
export type FieldOf<P extends Segments> = P extends readonly [
	infer Head extends string | number,
	...infer Rest extends Segments,
]
	? Rest extends readonly []
		? `${Head}`
		: `${Head}.${FieldOf<Rest>}`
	: never;

/** The react-hook-form name of the field an issue's path points at. */
export const fieldOf = <const P extends Segments>(path: P): FieldOf<P> =>
	path.join(".") as FieldOf<P>;
