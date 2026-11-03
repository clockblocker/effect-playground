import { expect, test } from "bun:test";
import type { StandardSchema } from "effect";
import { type FieldOf, fieldOf } from "../src/shared/field-of.ts";
import type { CustomCat } from "../src/shared/generated/protocol.ts";
import type { ReadFile } from "../src/shared/read-file.ts";

// Checked by `bun run check`; the test only keeps bun test from skipping the file.
type Equals<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const holds = <T extends true>(): T | undefined => undefined;

const inputFile: CustomCat.Path = ["inputFile"];
// @ts-expect-error ReadFile has no inputFile field.
const notReadFile: ReadFile.Path = ["inputFile"];
// @ts-expect-error CustomCat has no field below inputFile.
const tooDeep: CustomCat.Path = ["inputFile", 0];

holds<
	CustomCat.Issue extends StandardSchema.StandardSchemaV1.Issue ? true : false
>();
holds<
	ReadFile.Issue extends StandardSchema.StandardSchemaV1.Issue ? true : false
>();

const name = fieldOf(["inputFile"]);
holds<Equals<typeof name, "inputFile">>();
holds<Equals<FieldOf<CustomCat.Path>, "inputFile" | "outputFile">>();
holds<
	Equals<
		FieldOf<readonly ["files", number, "input"] | readonly ["label"]>,
		`files.${number}.input` | "label"
	>
>();

test("the generated types hold", () => {
	expect([inputFile, notReadFile, tooDeep, name]).toHaveLength(4);
});
