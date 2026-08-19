import styles from "./Footer.module.css";

export function Footer({ left, right }: { left: string; right: string }) {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </footer>
  );
}
