package com.kellencastilho.darota;

/** Geometry only: no Android dependencies, so progression can be regression tested. */
final class RouteProgress {
    final double[][] points;
    final double[] cumulative;
    double progress;
    boolean acquired;
    RouteProgress(double[][] points) {
        this.points = points;
        cumulative = new double[points.length];
        for (int i = 1; i < points.length; i++) cumulative[i] = cumulative[i-1] + distance(points[i-1], points[i]);
    }
    static double distance(double[] a, double[] b) {
        double x = Math.toRadians(b[1]-a[1]) * Math.cos(Math.toRadians((a[0]+b[0])/2));
        double y = Math.toRadians(b[0]-a[0]);
        return Math.hypot(x,y)*6371000;
    }
    double locate(double[] p, boolean advancing) {
        double best = Double.POSITIVE_INFINITY, along = progress;
        for (int i=1; i<points.length; i++) {
            // Avoid jumping to another lap at an intersection after acquiring the route.
            if (advancing && acquired && (cumulative[i] < progress-25 || cumulative[i-1] > progress+300)) continue;
            double scale = Math.cos(Math.toRadians(p[0]));
            double ax=(points[i-1][1]-p[1])*scale, ay=points[i-1][0]-p[0];
            double dx=(points[i][1]-points[i-1][1])*scale, dy=points[i][0]-points[i-1][0];
            double denom=dx*dx+dy*dy;
            double t=denom==0?0:Math.max(0,Math.min(1,-(ax*dx+ay*dy)/denom));
            double offset=Math.hypot(ax+t*dx,ay+t*dy)*111195;
            double candidate=cumulative[i-1]+t*(cumulative[i]-cumulative[i-1]);
            if (offset < best-0.1 || (Math.abs(offset-best)<0.1 && candidate<along)) { best=offset; along=candidate; }
        }
        if (advancing && best<=60) { progress=Math.max(progress,along); acquired=true; }
        return advancing?best:along;
    }
    static int stage(double meters) { return meters<=30?3:meters<=100?2:meters<=250?1:0; }
}
