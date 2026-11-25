import Link from 'next/link';
import type { Article } from './articles-content';
import { readingMinutes } from './articles-content';
import styles from './articles.module.css';

export function ArticleCard({
  article,
  headingLevel = 2,
}: {
  readonly article: Article;
  readonly headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <Link href={`/articles/${article.slug}`} className={styles.card}>
      <span className={styles.cardCategory}>{article.category}</span>
      <Heading className={styles.cardTitle}>{article.title}</Heading>
      <p className={styles.cardBody}>{article.description}</p>
      <span className={styles.cardMeta}>{readingMinutes(article)} min read</span>
    </Link>
  );
}
