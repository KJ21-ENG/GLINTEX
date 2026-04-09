import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, Badge, Button } from '../ui';
import { formatKg, formatDateDDMMYYYY } from '../../utils';
import {
  Package, Factory, Truck, Clock, ChevronDown, ChevronRight,
  Info, GitBranch, Maximize2, Minimize2, Target,
} from 'lucide-react';
import { cn } from '../../lib/utils';

const STAGE_ICONS = {
  inbound: Package,
  cutter_issue: Factory,
  cutter_receive: Factory,
  holo_issue: Factory,
  holo_receive: Factory,
  coning_issue: Factory,
  coning_receive: Factory,
  dispatch: Truck,
};

const STAGE_COLORS = {
  inbound: 'bg-blue-500',
  cutter_issue: 'bg-orange-500',
  cutter_receive: 'bg-orange-400',
  holo_issue: 'bg-purple-500',
  holo_receive: 'bg-purple-400',
  coning_issue: 'bg-teal-500',
  coning_receive: 'bg-teal-400',
  dispatch: 'bg-green-500',
};

const STAGE_BORDER_COLORS = {
  inbound: 'border-blue-500',
  cutter_issue: 'border-orange-500',
  cutter_receive: 'border-orange-400',
  holo_issue: 'border-purple-500',
  holo_receive: 'border-purple-400',
  coning_issue: 'border-teal-500',
  coning_receive: 'border-teal-400',
  dispatch: 'border-green-500',
};

const DEPTH_BAR_COLORS = [
  'bg-blue-500', 'bg-orange-500', 'bg-purple-500', 'bg-teal-500',
  'bg-green-500', 'bg-pink-500', 'bg-indigo-500', 'bg-amber-500',
];

const STAGE_LABELS = {
  inbound: 'Inbound',
  cutter_issue: 'Issued to Cutter',
  cutter_receive: 'Received from Cutter',
  holo_issue: 'Issued to Holo',
  holo_receive: 'Received from Holo',
  coning_issue: 'Issued to Coning',
  coning_receive: 'Received from Coning',
  dispatch: 'Dispatched',
};

function getNodeWeight(node) {
  if (!node?.data) return null;
  return node.data.weight || node.data.netWeight || node.data.totalWeight ||
    node.data.yarnKg || node.data.coneWeight || null;
}

function collectAllNodeIds(node, set = new Set()) {
  if (!node || node.truncated) return set;
  set.add(node.id);
  if (node.children) node.children.forEach(c => collectAllNodeIds(c, set));
  return set;
}

function findSearchedPath(node, path = []) {
  if (!node || node.truncated) return null;
  path.push(node.id);
  if (node.isSearched) return [...path];
  if (node.children) {
    for (const child of node.children) {
      const found = findSearchedPath(child, path);
      if (found) return found;
    }
  }
  path.pop();
  return null;
}

function summarizeBranch(node) {
  let count = 0;
  let totalWeight = 0;
  function walk(n) {
    if (!n || n.truncated) return;
    count++;
    const w = getNodeWeight(n);
    if (w) totalWeight += Number(w) || 0;
    if (n.children) n.children.forEach(walk);
  }
  if (node.children) node.children.forEach(walk);
  return { count, totalWeight };
}

export function BarcodeTreeView({ tree, stats, searchedBarcode }) {
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [expandedDetails, setExpandedDetails] = useState(new Set());
  const searchedRef = useRef(null);

  // On mount, expand all nodes on the searched path, and expand all by default
  useEffect(() => {
    if (!tree) return;
    const allIds = collectAllNodeIds(tree);
    setExpandedNodes(new Set(allIds));
    // Scroll to searched node after render
    setTimeout(() => {
      if (searchedRef.current) {
        searchedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 300);
  }, [tree]);

  const toggleNode = useCallback((nodeId) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const toggleDetails = useCallback((nodeId) => {
    setExpandedDetails(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (!tree) return;
    setExpandedNodes(collectAllNodeIds(tree));
  }, [tree]);

  const collapseAll = useCallback(() => {
    setExpandedNodes(new Set());
  }, []);

  const showSearchedPath = useCallback(() => {
    if (!tree) return;
    const path = findSearchedPath(tree);
    if (path) {
      setExpandedNodes(new Set(path));
      setTimeout(() => {
        if (searchedRef.current) {
          searchedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [tree]);

  if (!tree) return null;

  return (
    <div className="space-y-3">
      {/* Stats Bar */}
      {stats && (
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
          <Badge variant="outline" className="text-xs">
            {stats.totalNodes} record{stats.totalNodes !== 1 ? 's' : ''}
          </Badge>
          {stats.totalBranches > 0 && (
            <Badge variant="outline" className="text-xs">
              <GitBranch className="w-3 h-3 mr-1" />
              {stats.totalBranches} branch{stats.totalBranches !== 1 ? 'es' : ''}
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {stats.maxDepth} stage{stats.maxDepth !== 1 ? 's' : ''} deep
          </Badge>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={expandAll} className="h-7 text-xs">
          <Maximize2 className="w-3 h-3 mr-1" /> Expand All
        </Button>
        <Button size="sm" variant="ghost" onClick={collapseAll} className="h-7 text-xs">
          <Minimize2 className="w-3 h-3 mr-1" /> Collapse All
        </Button>
        <Button size="sm" variant="ghost" onClick={showSearchedPath} className="h-7 text-xs">
          <Target className="w-3 h-3 mr-1" /> Show Searched
        </Button>
      </div>

      {/* Tree */}
      <div className="space-y-0">
        <TreeNode
          node={tree}
          depth={0}
          isLast={true}
          parentDepths={[]}
          expandedNodes={expandedNodes}
          expandedDetails={expandedDetails}
          toggleNode={toggleNode}
          toggleDetails={toggleDetails}
          searchedRef={searchedRef}
        />
      </div>
    </div>
  );
}

function TreeNode({
  node, depth, isLast, parentDepths,
  expandedNodes, expandedDetails, toggleNode, toggleDetails,
  searchedRef,
}) {
  if (!node) return null;

  // Truncated marker
  if (node.truncated) {
    return (
      <div className="flex items-center gap-2 py-1">
        <DepthBars depths={parentDepths} />
        <ConnectorLine isLast={isLast} depth={depth} />
        <div className="text-xs text-muted-foreground italic px-2 py-1 bg-muted/50 rounded">
          {node.hiddenCount > 0 ? `${node.hiddenCount} more records (limit reached)` : 'More records (limit reached)'}
        </div>
      </div>
    );
  }

  const Icon = STAGE_ICONS[node.stage] || Package;
  const colorClass = STAGE_COLORS[node.stage] || 'bg-gray-500';
  const borderColor = STAGE_BORDER_COLORS[node.stage] || 'border-gray-500';
  const isExpanded = expandedNodes.has(node.id);
  const isDetailExpanded = expandedDetails.has(node.id);
  const hasChildren = node.children && node.children.length > 0;
  const branchCount = node.children?.filter(c => !c.truncated).length || 0;
  const weight = getNodeWeight(node);
  const isSearched = node.isSearched;

  const collapsedSummary = !isExpanded && hasChildren ? summarizeBranch(node) : null;

  return (
    <div>
      {/* Node card */}
      <div className="flex items-stretch">
        {/* Depth bars */}
        <DepthBars depths={parentDepths} />

        {/* Connector */}
        {depth > 0 && (
          <div className="flex flex-col items-center w-5 shrink-0">
            <div className={cn(
              "w-px flex-1",
              isLast ? "bg-border" : "bg-border"
            )} />
            <div className="w-3 h-px bg-border" style={{ alignSelf: 'flex-start', marginTop: '16px', marginLeft: '50%' }} />
          </div>
        )}

        {/* Card */}
        <div
          ref={isSearched ? searchedRef : null}
          className={cn(
            "flex-1 min-w-0 my-0.5",
            isSearched && "animate-pulse-once"
          )}
        >
          <Card className={cn(
            "transition-all overflow-hidden",
            isSearched && "ring-2 ring-primary shadow-md",
          )}>
            {/* Header row */}
            <div className="p-2 flex items-center gap-2">
              {/* Stage icon */}
              <div className={cn(
                "w-7 h-7 rounded-md flex items-center justify-center text-white shrink-0",
                colorClass
              )}>
                <Icon className="w-3.5 h-3.5" />
              </div>

              {/* Stage label + barcode */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-xs truncate">
                    {STAGE_LABELS[node.stage] || node.stage}
                  </span>
                  {branchCount > 1 && (
                    <Badge variant="secondary" className="text-[10px] h-4 px-1 shrink-0">
                      <GitBranch className="w-2.5 h-2.5 mr-0.5" />
                      {branchCount}
                    </Badge>
                  )}
                  {isSearched && (
                    <Badge className="text-[10px] h-4 px-1 bg-primary text-primary-foreground shrink-0">
                      Scanned
                    </Badge>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                  {node.barcode && <span className="font-mono truncate">{node.barcode}</span>}
                  {node.barcode && node.date && <span>·</span>}
                  {node.date && <span>{formatDateDDMMYYYY(node.date)}</span>}
                </div>
              </div>

              {/* Weight + controls */}
              <div className="flex items-center gap-1 shrink-0">
                {weight != null && (
                  <Badge variant="outline" className="text-[10px] h-5">
                    {formatKg(weight)}
                  </Badge>
                )}
                {/* Info toggle */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleDetails(node.id); }}
                  className={cn(
                    "w-6 h-6 flex items-center justify-center rounded hover:bg-muted transition-colors",
                    isDetailExpanded && "bg-muted"
                  )}
                >
                  <Info className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                {/* Expand/collapse children */}
                {hasChildren && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleNode(node.id); }}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Detail card */}
            <div className={cn(
              "overflow-hidden transition-all duration-300",
              isDetailExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
            )}>
              {node.data && (
                <div className="px-2 pb-2 border-t">
                  <div className="pt-2 grid grid-cols-2 gap-1.5 text-xs">
                    {Object.entries(node.data)
                      .filter(([key, value]) =>
                        value !== null && value !== undefined &&
                        !['pieceId', 'issueId', 'receiveId', 'dispatchId'].includes(key)
                      )
                      .map(([key, value]) => (
                        <div key={key} className="bg-muted/50 p-1.5 rounded">
                          <div className="text-muted-foreground text-[10px] capitalize">
                            {key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
                          </div>
                          <div className="font-medium truncate text-[11px]">
                            {typeof value === 'number' && key.toLowerCase().includes('weight')
                              ? formatKg(value)
                              : String(value || '—')}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>

            {/* Collapsed summary */}
            {collapsedSummary && collapsedSummary.count > 0 && (
              <div
                className="px-2 pb-1.5 text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                onClick={() => toggleNode(node.id)}
              >
                {collapsedSummary.count} more stage{collapsedSummary.count !== 1 ? 's' : ''}
                {collapsedSummary.totalWeight > 0 && ` · ${formatKg(collapsedSummary.totalWeight)} total`}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Children */}
      <div className={cn(
        "overflow-hidden transition-all duration-300",
        isExpanded ? "max-h-[5000px] opacity-100" : "max-h-0 opacity-0"
      )}>
        {hasChildren && node.children.map((child, index) => {
          const childIsLast = index === node.children.length - 1;
          const newParentDepths = [...parentDepths];
          if (depth > 0) {
            newParentDepths.push({ depth, isLast, stage: node.stage });
          }

          return (
            <TreeNode
              key={child.id || `truncated-${index}`}
              node={child}
              depth={depth + 1}
              isLast={childIsLast}
              parentDepths={newParentDepths}
              expandedNodes={expandedNodes}
              expandedDetails={expandedDetails}
              toggleNode={toggleNode}
              toggleDetails={toggleDetails}
              searchedRef={searchedRef}
            />
          );
        })}
      </div>
    </div>
  );
}

function DepthBars({ depths }) {
  if (!depths || depths.length === 0) return null;
  return (
    <div className="flex shrink-0">
      {depths.map((d, i) => (
        <div key={i} className="w-3 flex justify-center shrink-0">
          {!d.isLast && (
            <div className={cn("w-px h-full", "bg-border")} />
          )}
        </div>
      ))}
    </div>
  );
}

export default BarcodeTreeView;
