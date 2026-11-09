import { Context, Effect, Layer, Schema } from "effect";
import { SearchFile } from "../../../shared/generated/generated.ts";
import { BffReader } from "../read-file/read-file.ts";

/** Each field's issue, if its rules reject it, with the decode's message. */
const issuesOf = Effect.fn(function* (request: SearchFile.RequestShape) {
	const issues: SearchFile.Issue[] = [];
	for (const field of ["name", "query"] as const) {
		const decoded = yield* Schema.decodeUnknownEffect(
			SearchFile.Request.fields[field],
		)(request[field]).pipe(Effect.result);
		if (decoded._tag === "Failure") {
			issues.push({ message: decoded.failure.message, path: [field] });
		}
	}
	return issues;
});

/** Every line of `text` that contains `query`, numbered from 1. */
const matching = (text: string, query: string) =>
	text
		.split("\n")
		.flatMap((line, index) =>
			line.includes(query) ? [{ line: index + 1, text: line }] : [],
		);

export class BffSearcher extends Context.Service<
	BffSearcher,
	{
		readonly search: (
			request: SearchFile.RequestShape,
		) => Effect.Effect<SearchFile.Success, SearchFile.Failure>;
	}
>()("effect-playground/BffSearcher") {
	/** Searches with `BffReader`, which checks the name against the files. */
	static readonly layer = Layer.effect(
		BffSearcher,
		Effect.gen(function* () {
			const reader = yield* BffReader;
			const search = Effect.fn("BffSearcher.search")(function* (
				request: SearchFile.RequestShape,
			) {
				const [first, ...rest] = yield* issuesOf(request);
				if (first !== undefined) {
					return yield* new SearchFile.InvalidRequest({
						issues: [first, ...rest],
					});
				}
				const { contents } = yield* reader.read(request.name).pipe(
					Effect.catchTags({
						InvalidRequest: ({ issues }) =>
							Effect.fail(
								new SearchFile.InvalidRequest({ issues }),
							),
						IoFailed: ({ message }) =>
							Effect.fail(new SearchFile.IoFailed({ message })),
					}),
				);
				return { matches: matching(contents, request.query) };
			});
			return BffSearcher.of({ search });
		}),
	);
}
