import { useAtom } from "@effect/atom-react";
import { useForm } from "react-hook-form";
import type { CustomCat } from "../../shared/generated/protocol.ts";
import { BffRpcClient } from "../clients.ts";
import { Outcome, TextField, useSchemaResolver } from "./shared.tsx";

const customCat = BffRpcClient.mutation("CustomCat");

export function RunCliForm({
	schema,
}: {
	/** Validates the form; its type is the form's values. */
	schema: typeof CustomCat.Request;
}) {
	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm({
		resolver: useSchemaResolver(schema),
		defaultValues: { inputFile: "", outputFile: "" },
	});
	const [result, run] = useAtom(customCat, { mode: "promiseExit" });

	const submit = handleSubmit(async (payload) => {
		await run({ payload });
	});

	return (
		<section className="panel">
			<form onSubmit={submit}>
				<TextField
					label="input file"
					field={register("inputFile")}
					error={errors.inputFile}
				/>
				<TextField
					label="output file"
					field={register("outputFile")}
					error={errors.outputFile}
				/>
				<button type="submit" disabled={isSubmitting}>
					Copy
				</button>
			</form>
			<Outcome result={result}>
				{({ bytesCopied }) => <p>Copied {bytesCopied} bytes.</p>}
			</Outcome>
		</section>
	);
}
