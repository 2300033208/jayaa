"""initial schema

Revision ID: 0001
Revises: (none)
"""

from alembic import op
import sqlalchemy as sa


revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('users',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('display_name', sa.String(length=80), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.String(length=32), nullable=False),
    sa.Column('password_changed_at', sa.String(length=32), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email')
    )
    op.create_table('experiments',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('owner_id', sa.String(length=32), nullable=False),
    sa.Column('code', sa.String(length=16), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('created_at', sa.String(length=32), nullable=False),
    sa.Column('updated_at', sa.String(length=32), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('configuration_hash', sa.String(length=64), nullable=False),
    sa.Column('config', sa.JSON(), nullable=False),
    sa.Column('terrain_model_id', sa.String(length=32), nullable=True),
    sa.Column('latest_simulation_id', sa.String(length=32), nullable=True),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('owner_id', 'code', name='uq_experiment_owner_code')
    )
    with op.batch_alter_table('experiments', schema=None) as batch_op:
        batch_op.create_index('ix_experiments_owner_updated', ['owner_id', 'updated_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_experiments_terrain_model_id'), ['terrain_model_id'], unique=False)

    op.create_table('sessions',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.String(length=32), nullable=False),
    sa.Column('created_at', sa.Float(), nullable=False),
    sa.Column('last_seen_at', sa.Float(), nullable=False),
    sa.Column('expires_at', sa.Float(), nullable=False),
    sa.Column('user_agent', sa.String(length=200), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_sessions_user_id'), ['user_id'], unique=False)

    op.create_table('terrain_models',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('owner_id', sa.String(length=32), nullable=False),
    sa.Column('created_at', sa.String(length=32), nullable=False),
    sa.Column('meta', sa.JSON(), nullable=False),
    sa.Column('grid', sa.LargeBinary(), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('terrain_models', schema=None) as batch_op:
        batch_op.create_index('ix_terrain_models_owner_created', ['owner_id', 'created_at'], unique=False)

    op.create_table('datasets',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('experiment_id', sa.String(length=32), nullable=False),
    sa.Column('created_at', sa.String(length=32), nullable=False),
    sa.Column('meta', sa.JSON(), nullable=False),
    sa.Column('columns', sa.LargeBinary(), nullable=False),
    sa.Column('analysis', sa.LargeBinary(), nullable=True),
    sa.ForeignKeyConstraint(['experiment_id'], ['experiments.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('datasets', schema=None) as batch_op:
        batch_op.create_index('ix_datasets_experiment_created', ['experiment_id', 'created_at'], unique=False)

    op.create_table('simulations',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('experiment_id', sa.String(length=32), nullable=False),
    sa.Column('created_at', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('idempotency_key', sa.String(length=128), nullable=True),
    sa.Column('meta', sa.JSON(), nullable=False),
    sa.ForeignKeyConstraint(['experiment_id'], ['experiments.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('simulations', schema=None) as batch_op:
        batch_op.create_index('ix_simulations_experiment_created', ['experiment_id', 'created_at'], unique=False)
        batch_op.create_index('ix_simulations_experiment_key', ['experiment_id', 'idempotency_key'], unique=False)
        batch_op.create_index(batch_op.f('ix_simulations_status'), ['status'], unique=False)

    op.create_table('studies',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('experiment_id', sa.String(length=32), nullable=False),
    sa.Column('created_at', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('content', sa.LargeBinary(), nullable=False),
    sa.ForeignKeyConstraint(['experiment_id'], ['experiments.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('studies', schema=None) as batch_op:
        batch_op.create_index('ix_studies_experiment_created', ['experiment_id', 'created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_studies_status'), ['status'], unique=False)

    op.create_table('simulation_documents',
    sa.Column('simulation_id', sa.String(length=32), nullable=False),
    sa.Column('name', sa.String(length=32), nullable=False),
    sa.Column('content', sa.LargeBinary(), nullable=False),
    sa.ForeignKeyConstraint(['simulation_id'], ['simulations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('simulation_id', 'name')
    )


def downgrade() -> None:
    op.drop_table('simulation_documents')
    with op.batch_alter_table('studies', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_studies_status'))
        batch_op.drop_index('ix_studies_experiment_created')

    op.drop_table('studies')
    with op.batch_alter_table('simulations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_simulations_status'))
        batch_op.drop_index('ix_simulations_experiment_key')
        batch_op.drop_index('ix_simulations_experiment_created')

    op.drop_table('simulations')
    with op.batch_alter_table('datasets', schema=None) as batch_op:
        batch_op.drop_index('ix_datasets_experiment_created')

    op.drop_table('datasets')
    with op.batch_alter_table('terrain_models', schema=None) as batch_op:
        batch_op.drop_index('ix_terrain_models_owner_created')

    op.drop_table('terrain_models')
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_sessions_user_id'))

    op.drop_table('sessions')
    with op.batch_alter_table('experiments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_experiments_terrain_model_id'))
        batch_op.drop_index('ix_experiments_owner_updated')

    op.drop_table('experiments')
    op.drop_table('users')
