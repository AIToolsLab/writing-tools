import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import classes from './styles.module.css';

type ButtonColor = 'primary' | 'neutral';
type ButtonVariant = 'solid' | 'outline' | 'ghost';
type ButtonSize = 'small' | 'medium' | 'large';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	color?: ButtonColor;
	variant?: ButtonVariant;
	size?: ButtonSize;
	loading?: boolean;
	/** When set, renders an anchor instead of a button. */
	href?: string;
	/** Extra attributes applied to the rendered element. */
	attributes?: AnchorHTMLAttributes<HTMLAnchorElement>;
}

export function Button({
	color = 'neutral',
	variant = 'solid',
	size = 'medium',
	loading = false,
	disabled,
	className,
	children,
	type = 'button',
	href,
	attributes,
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
		.join(' ');

	const content = (
		<>
			{loading ? (
				<span className={classes.spinner} aria-hidden="true" />
			) : null}
			{children}
		</>
	);

	if (href) {
		return (
			<a
				href={href}
				className={classNames}
				aria-disabled={disabled || loading}
				{...attributes}
			>
				{content}
			</a>
		);
	}

	return (
		<button
			type={type}
			className={classNames}
			disabled={disabled || loading}
			{...rest}
		>
			{content}
		</button>
	);
}
