import * as React from 'react';
import styles from './UserBadge.module.css';

type Props = {
  name: string;
};

export default function UserBadge({ name }: Props) {
  // Use only the first letter of the first name as avatar
  const firstInitial = (name && name.split(' ').filter(Boolean)[0]?.[0])
    ? name.split(' ').filter(Boolean)[0][0].toUpperCase()
    : '?';

  return (
    <div className={styles.badge} role="group" aria-label={`User ${name}`}>
      <div className={`${styles.avatar} ${styles.initialAvatar}`}>
        {firstInitial}
      </div>

      <div className={styles.text}>
        <span className={styles.label}>User</span>
        <span className={styles.name}>{name}</span>
      </div>
    </div>
  );
}
