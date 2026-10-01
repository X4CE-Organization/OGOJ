import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { EmptyState, Loading } from '../components/ui';
import MomentCard, { type MomentItem } from '../components/MomentCard';
import BackButton from '../components/BackButton';

export default function MomentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings } = useAuth();
  const [moment, setMoment] = useState<MomentItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setLoading(true);
    setMissing(false);
    api
      .get<{ moment: MomentItem }>(`/api/moments/${id}`)
      .then((data) => setMoment(data.moment))
      .catch(() => setMissing(true))
      .finally(() => setLoading(false));
  }, [id]);

  const title = String(settings.moment_site_title ?? '动态') || '动态';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BackButton label={`返回${title}`} listKey="moments" fallback="/moments" />
      </div>

      {loading ? (
        <Loading />
      ) : missing || !moment ? (
        <EmptyState title="动态不存在" description="它可能已被作者或管理员删除。" />
      ) : (
        <MomentCard
          moment={moment}
          commentsOpen
          hideCommentsToggle
          onUpdate={(patch) => setMoment((current) => (current ? { ...current, ...patch } : current))}
          onDelete={() => navigate('/moments')}
        />
      )}
    </div>
  );
}
