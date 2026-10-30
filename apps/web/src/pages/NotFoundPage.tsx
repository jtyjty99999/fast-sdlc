import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui/Feedback';

export function NotFoundPage() {
  return (
    <EmptyState
      icon="?"
      title="页面不存在"
      description="这个地址没有对应的控制台页面。"
      action={<Link className="btn btn-primary" to="/">返回总览</Link>}
    />
  );
}
