import * as React from 'react';
import { Spinner, SpinnerSize } from '@fluentui/react';

export interface ProgressProps {
    message: string;
}

export default function Progress({ message }: ProgressProps) {
    return (
        <section className="ms-welcome__progress ms-u-fadeIn500">
            <Spinner size={SpinnerSize.large} label={message} />
        </section>
    );
}
