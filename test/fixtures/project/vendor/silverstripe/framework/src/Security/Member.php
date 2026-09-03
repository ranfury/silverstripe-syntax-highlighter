<?php

namespace SilverStripe\Security;

use SilverStripe\ORM\DataObject;

class Member extends DataObject
{
    private static $db = [
        'FirstName' => 'Varchar(255)',
        'Surname' => 'Varchar(255)',
        'Email' => 'Varchar(255)',
    ];
}
