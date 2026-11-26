import { Link } from 'react-router'
import { EmptyState } from '../components/feedback/States'
import { Page, PageHeader } from '../components/layout/Page'
import styles from './pages.module.css'

export default function NotFoundPage() {
  return (
    <Page label="Page not found">
      <PageHeader title="Page not found" />
      <EmptyState
        title="This page does not exist."
        message="The address may be mistyped, or the item it pointed to was deleted."
        actions={
          <Link className={styles.primaryLink} to="/">
            Go to start
          </Link>
        }
      />
    </Page>
  )
}
