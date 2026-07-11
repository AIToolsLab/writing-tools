import type { ButtonHTMLAttributes } from "react";
import classes from "./styles.module.css";

type ButtonColor = "primary" | "neutral";
type ButtonVariant = "solid" | "outline" | "ghost";
type ButtonSize = "medium" | "large";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	color?: ButtonColor;
	variant?: ButtonVariant;
	size?: ButtonSize;
	loading?: boolean;
}

export function Button({
	color = "neutral",
	variant = "solid",
	size = "medium",
	loading = false,
	disabled,
	className,
	children,
	type = "button",
	...rest
}: ButtonProps) {
	const classNames = [
		classes.button,
		classes[color],
		classes[variant],
		classes[size],
		className,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<button
			type={type}
			className={classNames}
			disabled={disabled || loading}
			{...rest}
		>
			{loading && <span className={classes.spinner} aria-hidden="true" />}
			{children}
		</button>
	);
}
