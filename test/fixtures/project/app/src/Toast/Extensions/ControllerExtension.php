<?php

namespace Toast\Extensions;

use SilverStripe\Core\Extension;

class ControllerExtension extends Extension
{
    public function getStyleTag($path = '')
    {
        return $path;
    }
}
