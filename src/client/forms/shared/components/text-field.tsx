import { useId } from "react";
import type { FieldError, UseFormRegisterReturn } from "react-hook-form";

export function TextField({
	label,
	field,
	error,
}: {
	label: string;
	field: UseFormRegisterReturn;
	error: FieldError | undefined;
}) {
	const errorId = useId();
	return (
		<div className="field">
			<input
				aria-label={label}
				placeholder={label}
				aria-invalid={error !== undefined}
				aria-describedby={error && errorId}
				{...field}
			/>
			{error && (
				<p id={errorId} className="field-error">
					{error.message}
				</p>
			)}
		</div>
	);
}
